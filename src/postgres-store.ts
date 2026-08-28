import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { emptyMetrics, emptyState, type Store } from "./store.js";
import type {
  ActionRecord,
  AppMetrics,
  AuditLog,
  ConnectionStatus,
  GroupRecord,
  MemberRecord,
  MemoryRecord,
  PersistedState,
  ProviderUsageRecord,
  SessionRecord,
  StoredMessage,
  UserRecord,
} from "./types.js";

type Sql = ReturnType<typeof neon>;
type Row = Record<string, unknown>;

export class PostgresStore implements Store {
  private state: PersistedState = emptyState();
  private initialized = false;
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.createSchema();
    this.state = emptyState();
    const [groups, members, messages, memories, actions, logs, usage, runtime, settings, users, sessions] = await Promise.all([
      this.sql`SELECT id, whatsapp_group_id, subject, participant_count, is_admin, enabled, ai_paused, personality_override_json, last_seen_at FROM groups`,
      this.sql`SELECT id, group_id, whatsapp_member_id, display_name, behavior_profile_json, confidence_json, first_seen_at, last_seen_at FROM members`,
      this.sql`SELECT id, chat_id, group_id, sender_id, sender_name, timestamp_ms, message_type, text_or_transcript, quoted_message_id, quoted_sender_id, mentioned_member_ids_json, media_metadata_json, is_group, is_status, is_from_bot, stored_at FROM messages`,
      this.sql`SELECT id, scope_type, scope_id, memory_type, value_json, confidence, evidence_count, created_at, last_confirmed_at, expires_at FROM memories`,
      this.sql`SELECT id, idempotency_key, group_id, source_message_id, action_type, target_message_id, payload_json, scheduled_for, status, executed_at, error FROM ai_actions`,
      this.sql`SELECT id, event, level, message_id, group_id, details_json, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 500`,
      this.sql`SELECT provider, operation, group_id, units, success, latency_ms, created_at FROM provider_usage ORDER BY created_at DESC LIMIT 1000`,
      this.sql`SELECT connection_status, pairing_code, last_connected_at, metrics_json FROM runtime_state WHERE id = 1`,
       this.sql`SELECT outbound_paused, ai_processing_paused, direct_message_allowlist_json, personality_json FROM app_settings WHERE id = 1`,
      this.sql`SELECT id, email, password_hash, role, created_at FROM users`,
      this.sql`SELECT token_hash, user_id, created_at, expires_at FROM sessions WHERE expires_at > ${Date.now()}`,
    ]);
    for (const row of groups as Row[]) this.state.groups[String(row.id)] = groupFromRow(row);
    for (const row of members as Row[]) this.state.members[String(row.id)] = memberFromRow(row);
    for (const row of messages as Row[]) this.state.messages[String(row.id)] = messageFromRow(row);
    for (const row of memories as Row[]) this.state.memories[String(row.id)] = memoryFromRow(row);
    for (const row of actions as Row[]) this.state.actions[String(row.id)] = actionFromRow(row);
    this.state.logs = (logs as Row[]).reverse().map(logFromRow);
    this.state.providerUsage = (usage as Row[]).reverse().map(usageFromRow);
    const runtimeRow = (runtime as Row[])[0];
    if (runtimeRow) {
      this.state.runtime = {
        connectionStatus: String(runtimeRow.connection_status) as ConnectionStatus,
        ...(runtimeRow.pairing_code ? { pairingCode: String(runtimeRow.pairing_code) } : {}),
        ...(runtimeRow.last_connected_at ? { lastConnectedAt: Number(runtimeRow.last_connected_at) } : {}),
        metrics: { ...emptyMetrics(), ...jsonObject(runtimeRow.metrics_json, {}) },
      };
    }
    const settingsRow = (settings as Row[])[0];
    if (settingsRow) {
      this.state.settings = {
        outboundPaused: Boolean(settingsRow.outbound_paused),
        aiProcessingPaused: Boolean(settingsRow.ai_processing_paused),
        directMessageAllowlist: jsonArray(settingsRow.direct_message_allowlist_json),
        personality: jsonObject(settingsRow.personality_json, {}),
      };
    }
    for (const row of users as Row[]) this.state.users[String(row.id)] = userFromRow(row);
    for (const row of sessions as Row[]) this.state.sessions[String(row.token_hash)] = sessionFromRow(row);
    this.initialized = true;
  }

  get snapshot(): PersistedState {
    return structuredClone(this.state);
  }

  async setConnection(status: ConnectionStatus, pairingCode?: string): Promise<void> {
    this.state.runtime.connectionStatus = status;
    if (pairingCode === undefined) delete this.state.runtime.pairingCode;
    else this.state.runtime.pairingCode = pairingCode;
    if (status === "CONNECTED") this.state.runtime.lastConnectedAt = Date.now();
    await this.persistRuntime();
  }

  settings(): PersistedState["settings"] {
    return this.state.settings;
  }

  async updateSettings(update: NonNullable<PersistedState["settings"]>): Promise<void> {
    this.state.settings = {
      ...this.state.settings,
      ...update,
      ...(update.personality ? { personality: { ...this.state.settings?.personality, ...update.personality } } : {}),
    };
    await this.sql`INSERT INTO app_settings (id, outbound_paused, ai_processing_paused, direct_message_allowlist_json, personality_json)
      VALUES (1, ${this.state.settings.outboundPaused ?? false}, ${this.state.settings.aiProcessingPaused ?? false}, ${JSON.stringify(this.state.settings.directMessageAllowlist ?? [])}::jsonb, ${JSON.stringify(this.state.settings.personality ?? {})}::jsonb)
      ON CONFLICT (id) DO UPDATE SET outbound_paused = EXCLUDED.outbound_paused, ai_processing_paused = EXCLUDED.ai_processing_paused, direct_message_allowlist_json = EXCLUDED.direct_message_allowlist_json, personality_json = EXCLUDED.personality_json`;
  }

  async updateMetrics(update: Partial<AppMetrics>): Promise<void> {
    this.state.runtime.metrics = { ...this.state.runtime.metrics, ...update };
    await this.persistRuntime();
  }

  async incrementMetric(key: keyof AppMetrics, amount = 1): Promise<void> {
    this.state.runtime.metrics[key] += amount;
    await this.persistRuntime();
  }

  async upsertGroup(group: GroupRecord): Promise<void> {
    await this.sql`INSERT INTO groups (id, whatsapp_group_id, subject, participant_count, is_admin, enabled, ai_paused, personality_override_json, last_seen_at)
      VALUES (${group.id}, ${group.whatsappGroupId}, ${group.subject}, ${group.participantCount}, ${group.isAdmin}, ${group.enabled}, ${group.aiPaused}, ${group.personalityOverride ? JSON.stringify(group.personalityOverride) : null}::jsonb, ${group.lastSeenAt})
      ON CONFLICT (id) DO UPDATE SET whatsapp_group_id = EXCLUDED.whatsapp_group_id, subject = EXCLUDED.subject, participant_count = EXCLUDED.participant_count, is_admin = EXCLUDED.is_admin, enabled = EXCLUDED.enabled, ai_paused = EXCLUDED.ai_paused, personality_override_json = EXCLUDED.personality_override_json, last_seen_at = EXCLUDED.last_seen_at`;
    this.state.groups[group.id] = group;
  }

  async deleteGroup(id: string): Promise<void> {
    await this.sql`DELETE FROM members WHERE group_id = ${id}`;
    await this.sql`DELETE FROM groups WHERE id = ${id}`;
    delete this.state.groups[id];
    for (const [memberId, member] of Object.entries(this.state.members)) {
      if (member.groupId === id) delete this.state.members[memberId];
    }
  }

  async updateGroup(id: string, update: Partial<GroupRecord>): Promise<GroupRecord | undefined> {
    const current = this.state.groups[id];
    if (!current) return undefined;
    const group = { ...current, ...update };
    await this.upsertGroup(group);
    return group;
  }

  async upsertMember(member: MemberRecord): Promise<void> {
    await this.sql`INSERT INTO members (id, group_id, whatsapp_member_id, display_name, behavior_profile_json, confidence_json, first_seen_at, last_seen_at)
      VALUES (${member.id}, ${member.groupId}, ${member.whatsappMemberId}, ${member.displayName ?? null}, ${JSON.stringify(member.behaviorProfile)}::jsonb, ${JSON.stringify(member.confidence)}::jsonb, ${member.firstSeenAt}, ${member.lastSeenAt})
      ON CONFLICT (id) DO UPDATE SET group_id = EXCLUDED.group_id, whatsapp_member_id = EXCLUDED.whatsapp_member_id, display_name = EXCLUDED.display_name, behavior_profile_json = EXCLUDED.behavior_profile_json, confidence_json = EXCLUDED.confidence_json, last_seen_at = EXCLUDED.last_seen_at`;
    this.state.members[member.id] = member;
  }

  async storeMessage(message: StoredMessage): Promise<boolean> {
    const rows = await this.sql`INSERT INTO messages (id, chat_id, group_id, sender_id, sender_name, timestamp_ms, message_type, text_or_transcript, quoted_message_id, quoted_sender_id, mentioned_member_ids_json, media_metadata_json, is_group, is_status, is_from_bot, stored_at)
      VALUES (${message.id}, ${message.chatId}, ${message.groupId ?? null}, ${message.senderId}, ${message.senderName ?? null}, ${message.timestamp}, ${message.type}, ${message.text ?? null}, ${message.quotedMessageId ?? null}, ${message.quotedSenderId ?? null}, ${JSON.stringify(message.mentionedIds)}::jsonb, ${message.media ? JSON.stringify(message.media) : null}::jsonb, ${message.isGroup}, ${message.isStatus}, ${message.isFromBot}, ${message.storedAt})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.messages[message.id] = message;
    return true;
  }

  async upsertMemory(memory: MemoryRecord): Promise<void> {
    await this.sql`INSERT INTO memories (id, scope_type, scope_id, memory_type, value_json, confidence, evidence_count, created_at, last_confirmed_at, expires_at)
      VALUES (${memory.id}, ${memory.scopeType}, ${memory.scopeId}, ${memory.memoryType}, ${JSON.stringify(memory.value)}::jsonb, ${memory.confidence}, ${memory.evidenceCount}, ${memory.createdAt}, ${memory.lastConfirmedAt}, ${memory.expiresAt ?? null})
      ON CONFLICT (id) DO UPDATE SET value_json = EXCLUDED.value_json, confidence = EXCLUDED.confidence, evidence_count = EXCLUDED.evidence_count, last_confirmed_at = EXCLUDED.last_confirmed_at, expires_at = EXCLUDED.expires_at`;
    this.state.memories[memory.id] = memory;
  }

  async deleteMemories(scopeId: string): Promise<number> {
    const rows = await this.sql`DELETE FROM memories WHERE scope_id = ${scopeId} RETURNING id`;
    const ids = (rows as Row[]).map((row) => String(row.id));
    for (const id of ids) delete this.state.memories[id];
    return ids.length;
  }

  async createAction(action: ActionRecord): Promise<boolean> {
    const rows = await this.sql`INSERT INTO ai_actions (id, idempotency_key, group_id, source_message_id, action_type, target_message_id, payload_json, scheduled_for, status, executed_at, error)
      VALUES (${action.id}, ${action.idempotencyKey}, ${action.groupId}, ${action.sourceMessageId}, ${action.actionType}, ${action.targetMessageId ?? null}, ${JSON.stringify(action.payload)}::jsonb, ${action.scheduledFor}, ${action.status}, ${action.executedAt ?? null}, ${action.error ?? null})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.actions[action.id] = action;
    return true;
  }

  async updateAction(id: string, update: Partial<ActionRecord>): Promise<ActionRecord | undefined> {
    const current = this.state.actions[id];
    if (!current) return undefined;
    const action = { ...current, ...update };
    await this.sql`UPDATE ai_actions SET status = ${action.status}, target_message_id = ${action.targetMessageId ?? null}, payload_json = ${JSON.stringify(action.payload)}::jsonb, scheduled_for = ${action.scheduledFor}, executed_at = ${action.executedAt ?? null}, error = ${action.error ?? null} WHERE id = ${id}`;
    this.state.actions[id] = action;
    return action;
  }

  async addLog(log: AuditLog): Promise<void> {
    await this.sql`INSERT INTO audit_logs (id, event, level, message_id, group_id, details_json, created_at)
      VALUES (${log.id}, ${log.event}, ${log.level}, ${log.messageId ?? null}, ${log.groupId ?? null}, ${JSON.stringify(log.details)}::jsonb, ${log.createdAt})
      ON CONFLICT (id) DO NOTHING`;
    this.state.logs.push(log);
    this.state.logs = this.state.logs.slice(-500);
  }

  async addProviderUsage(usage: ProviderUsageRecord): Promise<void> {
    await this.sql`INSERT INTO provider_usage (provider, operation, group_id, units, success, latency_ms, created_at)
      VALUES (${usage.provider}, ${usage.operation}, ${usage.groupId ?? null}, ${usage.units}, ${usage.success}, ${usage.latencyMs}, ${usage.createdAt})`;
    this.state.providerUsage.push(usage);
    this.state.providerUsage = this.state.providerUsage.slice(-1000);
  }

  async createUser(user: UserRecord): Promise<boolean> {
    const rows = await this.sql`INSERT INTO users (id, email, password_hash, role, created_at)
      VALUES (${user.id}, ${user.email}, ${user.passwordHash}, ${user.role}, ${user.createdAt})
      ON CONFLICT (email) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.users[user.id] = user;
    return true;
  }

  userByEmail(email: string): UserRecord | undefined {
    return Object.values(this.state.users).find((user) => user.email === email);
  }

  userById(id: string): UserRecord | undefined { return this.state.users[id]; }
  userCount(): number { return Object.keys(this.state.users).length; }

  async createSession(session: SessionRecord): Promise<void> {
    await this.sql`INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
      VALUES (${session.tokenHash}, ${session.userId}, ${session.createdAt}, ${session.expiresAt})
      ON CONFLICT (token_hash) DO UPDATE SET user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`;
    this.state.sessions[session.tokenHash] = session;
  }

  sessionByTokenHash(tokenHash: string): SessionRecord | undefined { return this.state.sessions[tokenHash]; }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
    delete this.state.sessions[tokenHash];
  }

  recentMessages(groupId: string, limit: number): StoredMessage[] {
    return Object.values(this.state.messages).filter((message) => message.groupId === groupId).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit).reverse();
  }

  message(id: string): StoredMessage | undefined { return this.state.messages[id]; }
  group(id: string): GroupRecord | undefined { return this.state.groups[id]; }
  groups(): GroupRecord[] { return Object.values(this.state.groups).sort((a, b) => a.subject.localeCompare(b.subject)); }
  members(groupId?: string): MemberRecord[] { return Object.values(this.state.members).filter((member) => !groupId || member.groupId === groupId); }
  memories(scopeId?: string): MemoryRecord[] { return Object.values(this.state.memories).filter((memory) => !scopeId || memory.scopeId === scopeId); }
  logs(limit = 100): AuditLog[] { return this.state.logs.slice(-limit).reverse(); }
  actions(limit = 100): ActionRecord[] { return Object.values(this.state.actions).sort((a, b) => b.scheduledFor - a.scheduledFor).slice(0, limit); }

  private async createSchema(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS groups (id text PRIMARY KEY, whatsapp_group_id text UNIQUE NOT NULL, subject text NOT NULL, participant_count integer NOT NULL, is_admin boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false, ai_paused boolean NOT NULL DEFAULT false, personality_override_json jsonb, last_seen_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS members (id text PRIMARY KEY, group_id text NOT NULL, whatsapp_member_id text NOT NULL, display_name text, behavior_profile_json jsonb NOT NULL, confidence_json jsonb NOT NULL, first_seen_at bigint NOT NULL, last_seen_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, chat_id text NOT NULL, group_id text, sender_id text NOT NULL, sender_name text, timestamp_ms bigint NOT NULL, message_type text NOT NULL, text_or_transcript text, quoted_message_id text, quoted_sender_id text, mentioned_member_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb, media_metadata_json jsonb, is_group boolean NOT NULL, is_status boolean NOT NULL, is_from_bot boolean NOT NULL, stored_at bigint NOT NULL)`;
    await this.sql`CREATE INDEX IF NOT EXISTS messages_group_time_idx ON messages (group_id, timestamp_ms DESC)`;
    await this.sql`CREATE TABLE IF NOT EXISTS memories (id text PRIMARY KEY, scope_type text NOT NULL, scope_id text NOT NULL, memory_type text NOT NULL, value_json jsonb NOT NULL, confidence real NOT NULL, evidence_count integer NOT NULL, created_at bigint NOT NULL, last_confirmed_at bigint NOT NULL, expires_at bigint)`;
    await this.sql`CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories (scope_id)`;
    await this.sql`CREATE TABLE IF NOT EXISTS ai_actions (id text PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, group_id text NOT NULL, source_message_id text NOT NULL, action_type text NOT NULL, target_message_id text, payload_json jsonb NOT NULL, scheduled_for bigint NOT NULL, status text NOT NULL, executed_at bigint, error text)`;
    await this.sql`CREATE INDEX IF NOT EXISTS actions_group_time_idx ON ai_actions (group_id, scheduled_for DESC)`;
    await this.sql`CREATE TABLE IF NOT EXISTS audit_logs (id text PRIMARY KEY, event text NOT NULL, level text NOT NULL, message_id text, group_id text, details_json jsonb NOT NULL, created_at bigint NOT NULL)`;
    await this.sql`CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs (created_at DESC)`;
    await this.sql`CREATE TABLE IF NOT EXISTS provider_usage (id bigserial PRIMARY KEY, provider text NOT NULL, operation text NOT NULL, group_id text, units integer NOT NULL, success boolean NOT NULL, latency_ms integer NOT NULL, created_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL, created_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL)`;
    await this.sql`CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)`;
     await this.sql`CREATE TABLE IF NOT EXISTS app_settings (id integer PRIMARY KEY CHECK (id = 1), outbound_paused boolean NOT NULL DEFAULT false, ai_processing_paused boolean NOT NULL DEFAULT false, direct_message_allowlist_json jsonb NOT NULL DEFAULT '[]'::jsonb, personality_json jsonb NOT NULL DEFAULT '{}'::jsonb)`;
     await this.sql`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS direct_message_allowlist_json jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await this.sql`CREATE TABLE IF NOT EXISTS runtime_state (id integer PRIMARY KEY CHECK (id = 1), connection_status text NOT NULL, pairing_code text, last_connected_at bigint, metrics_json jsonb NOT NULL)`;
    await this.sql`INSERT INTO schema_migrations (version, applied_at) VALUES (1, ${Date.now()}) ON CONFLICT (version) DO NOTHING`;
  }

  private async persistRuntime(): Promise<void> {
    await this.sql`INSERT INTO runtime_state (id, connection_status, pairing_code, last_connected_at, metrics_json)
      VALUES (1, ${this.state.runtime.connectionStatus}, ${this.state.runtime.pairingCode ?? null}, ${this.state.runtime.lastConnectedAt ?? null}, ${JSON.stringify(this.state.runtime.metrics)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET connection_status = EXCLUDED.connection_status, pairing_code = EXCLUDED.pairing_code, last_connected_at = EXCLUDED.last_connected_at, metrics_json = EXCLUDED.metrics_json`;
  }
}

function jsonObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return fallback; }
  }
  return fallback;
}

function groupFromRow(row: Row): GroupRecord {
  const personality = jsonObject(row.personality_override_json, {});
  return {
    id: String(row.id), whatsappGroupId: String(row.whatsapp_group_id), subject: String(row.subject), participantCount: Number(row.participant_count), isAdmin: Boolean(row.is_admin), enabled: Boolean(row.enabled), aiPaused: Boolean(row.ai_paused),
    ...(Object.keys(personality).length ? { personalityOverride: personality } : {}), lastSeenAt: Number(row.last_seen_at),
  };
}

function memberFromRow(row: Row): MemberRecord {
  return { id: String(row.id), groupId: String(row.group_id), whatsappMemberId: String(row.whatsapp_member_id), ...(row.display_name ? { displayName: String(row.display_name) } : {}), behaviorProfile: jsonObject(row.behavior_profile_json, {}) as MemberRecord["behaviorProfile"], confidence: jsonObject(row.confidence_json, {}) as Record<string, number>, firstSeenAt: Number(row.first_seen_at), lastSeenAt: Number(row.last_seen_at) };
}

function messageFromRow(row: Row): StoredMessage {
  const media = jsonObject(row.media_metadata_json, {});
  return { id: String(row.id), chatId: String(row.chat_id), ...(row.group_id ? { groupId: String(row.group_id) } : {}), senderId: String(row.sender_id), ...(row.sender_name ? { senderName: String(row.sender_name) } : {}), timestamp: Number(row.timestamp_ms), type: String(row.message_type) as StoredMessage["type"], ...(row.text_or_transcript ? { text: String(row.text_or_transcript) } : {}), ...(row.quoted_message_id ? { quotedMessageId: String(row.quoted_message_id) } : {}), ...(row.quoted_sender_id ? { quotedSenderId: String(row.quoted_sender_id) } : {}), mentionedIds: jsonArray(row.mentioned_member_ids_json), ...(Object.keys(media).length ? { media: media as unknown as StoredMessage["media"] } : {}), isGroup: Boolean(row.is_group), isStatus: Boolean(row.is_status), isFromBot: Boolean(row.is_from_bot), storedAt: Number(row.stored_at) };
}

function memoryFromRow(row: Row): MemoryRecord {
  return { id: String(row.id), scopeType: String(row.scope_type) as MemoryRecord["scopeType"], scopeId: String(row.scope_id), memoryType: String(row.memory_type), value: jsonObject(row.value_json, {}), confidence: Number(row.confidence), evidenceCount: Number(row.evidence_count), createdAt: Number(row.created_at), lastConfirmedAt: Number(row.last_confirmed_at), ...(row.expires_at ? { expiresAt: Number(row.expires_at) } : {}) };
}

function actionFromRow(row: Row): ActionRecord {
  return { id: String(row.id), idempotencyKey: String(row.idempotency_key), groupId: String(row.group_id), sourceMessageId: String(row.source_message_id), actionType: String(row.action_type) as ActionRecord["actionType"], ...(row.target_message_id ? { targetMessageId: String(row.target_message_id) } : {}), payload: jsonObject(row.payload_json, {}), scheduledFor: Number(row.scheduled_for), status: String(row.status) as ActionRecord["status"], ...(row.executed_at ? { executedAt: Number(row.executed_at) } : {}), ...(row.error ? { error: String(row.error) } : {}) };
}

function logFromRow(row: Row): AuditLog {
  return { id: String(row.id), event: String(row.event), level: String(row.level) as AuditLog["level"], ...(row.message_id ? { messageId: String(row.message_id) } : {}), ...(row.group_id ? { groupId: String(row.group_id) } : {}), details: jsonObject(row.details_json, {}), createdAt: Number(row.created_at) };
}

function usageFromRow(row: Row): ProviderUsageRecord {
  return { provider: String(row.provider), operation: String(row.operation), ...(row.group_id ? { groupId: String(row.group_id) } : {}), units: Number(row.units), success: Boolean(row.success), latencyMs: Number(row.latency_ms), createdAt: Number(row.created_at) };
}

function userFromRow(row: Row): UserRecord {
  return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash), role: String(row.role) as UserRecord["role"], createdAt: Number(row.created_at) };
}

function sessionFromRow(row: Row): SessionRecord {
  return { tokenHash: String(row.token_hash), userId: String(row.user_id), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) };
}

function jsonArray(value: unknown): string[] {
  const object = jsonObject(value, {});
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (Array.isArray(object)) return object.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
  }
  return [];
}
