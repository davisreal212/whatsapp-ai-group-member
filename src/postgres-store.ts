import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { emptyMetrics, emptyState, type PruneResult, type Store } from "./store.js";
import type {
  ActionRecord,
  AppMetrics,
  AuditLog,
  ConnectionStatus,
  GroupRecord,
  InboundJobRecord,
  InboundJobStatus,
  MemberRecord,
  MemoryRecord,
  MemoryVectorJobRecord,
  MemoryVectorJobStatus,
  PersistedState,
  ProviderUsageRecord,
  SessionRecord,
  StoredMessage,
  TaskRecord,
  TaskStatus,
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
    const [groups, members, messages, memories, memoryVectorJobs, actions, tasks, inboundJobs, logs, usage, runtime, settings, users, sessions] = await Promise.all([
       this.sql`SELECT id, whatsapp_group_id, subject, participant_count, is_admin, enabled, ai_paused, learning_enabled, personality_override_json, participation_override_json, last_seen_at FROM groups`,
      this.sql`SELECT id, group_id, whatsapp_member_id, display_name, behavior_profile_json, confidence_json, first_seen_at, last_seen_at FROM members`,
      this.sql`SELECT id, chat_id, group_id, sender_id, sender_name, timestamp_ms, message_type, text_or_transcript, transcript_confidence, transcript_language, quoted_message_id, quoted_sender_id, mentioned_member_ids_json, media_metadata_json, is_group, is_status, is_from_bot, stored_at FROM messages`,
       this.sql`SELECT id, scope_type, scope_id, memory_type, value_json, confidence, importance, status, evidence_count, created_at, last_confirmed_at, updated_at, source_message_id, source_timestamp, source_member_id, expires_at FROM memories`,
       this.sql`SELECT id, memory_id, operation, memory_updated_at, status, attempts, created_at, updated_at, next_attempt_at, last_error FROM memory_vector_jobs ORDER BY created_at ASC`,
      this.sql`SELECT id, idempotency_key, group_id, source_message_id, action_type, target_message_id, payload_json, scheduled_for, status, attempts, next_attempt_at, executed_at, error FROM ai_actions`,
      this.sql`SELECT id, group_id, creator_id, creator_chat_id, type, condition_json, message, status, trigger_at, recurrence, notification_target, notification_chat_id, created_at, last_checked_at, last_successful_check, last_error, retry_count FROM tasks`,
      this.sql`SELECT id, message_id, chat_id, message_json, status, attempts, created_at, updated_at, next_attempt_at, last_error FROM inbound_jobs ORDER BY created_at ASC`,
      this.sql`SELECT id, event, level, message_id, group_id, details_json, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 500`,
      this.sql`SELECT provider, operation, group_id, units, success, latency_ms, created_at FROM provider_usage ORDER BY created_at DESC LIMIT 1000`,
      this.sql`SELECT connection_status, pairing_code, last_connected_at, metrics_json FROM runtime_state WHERE id = 1`,
        this.sql`SELECT outbound_paused, ai_processing_paused, direct_message_allowlist_json, personality_json, participation_json FROM app_settings WHERE id = 1`,
      this.sql`SELECT id, email, password_hash, role, created_at FROM users`,
      this.sql`SELECT token_hash, user_id, created_at, expires_at FROM sessions WHERE expires_at > ${Date.now()}`,
    ]);
    for (const row of groups as Row[]) this.state.groups[String(row.id)] = groupFromRow(row);
    for (const row of members as Row[]) this.state.members[String(row.id)] = memberFromRow(row);
    for (const row of messages as Row[]) this.state.messages[String(row.id)] = messageFromRow(row);
    for (const row of memories as Row[]) this.state.memories[String(row.id)] = memoryFromRow(row);
    for (const row of memoryVectorJobs as Row[]) this.state.memoryVectorJobs[String(row.id)] = memoryVectorJobFromRow(row);
    for (const row of actions as Row[]) this.state.actions[String(row.id)] = actionFromRow(row);
    for (const row of tasks as Row[]) this.state.tasks[String(row.id)] = taskFromRow(row);
    for (const row of inboundJobs as Row[]) this.state.inboundJobs[String(row.id)] = inboundJobFromRow(row);
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
        participation: jsonObject(settingsRow.participation_json, {}),
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
      ...(update.participation ? { participation: { ...this.state.settings?.participation, ...update.participation } } : {}),
    };
    await this.sql`INSERT INTO app_settings (id, outbound_paused, ai_processing_paused, direct_message_allowlist_json, personality_json, participation_json)
      VALUES (1, ${this.state.settings.outboundPaused ?? false}, ${this.state.settings.aiProcessingPaused ?? false}, ${JSON.stringify(this.state.settings.directMessageAllowlist ?? [])}::jsonb, ${JSON.stringify(this.state.settings.personality ?? {})}::jsonb, ${JSON.stringify(this.state.settings.participation ?? {})}::jsonb)
      ON CONFLICT (id) DO UPDATE SET outbound_paused = EXCLUDED.outbound_paused, ai_processing_paused = EXCLUDED.ai_processing_paused, direct_message_allowlist_json = EXCLUDED.direct_message_allowlist_json, personality_json = EXCLUDED.personality_json, participation_json = EXCLUDED.participation_json`;
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
    await this.sql`INSERT INTO groups (id, whatsapp_group_id, subject, participant_count, is_admin, enabled, ai_paused, learning_enabled, personality_override_json, participation_override_json, last_seen_at)
      VALUES (${group.id}, ${group.whatsappGroupId}, ${group.subject}, ${group.participantCount}, ${group.isAdmin}, ${group.enabled}, ${group.aiPaused}, ${group.learningEnabled ?? true}, ${group.personalityOverride ? JSON.stringify(group.personalityOverride) : null}::jsonb, ${group.participationOverride ? JSON.stringify(group.participationOverride) : null}::jsonb, ${group.lastSeenAt})
      ON CONFLICT (id) DO UPDATE SET whatsapp_group_id = EXCLUDED.whatsapp_group_id, subject = EXCLUDED.subject, participant_count = EXCLUDED.participant_count, is_admin = EXCLUDED.is_admin, enabled = EXCLUDED.enabled, ai_paused = EXCLUDED.ai_paused, learning_enabled = EXCLUDED.learning_enabled, personality_override_json = EXCLUDED.personality_override_json, participation_override_json = EXCLUDED.participation_override_json, last_seen_at = EXCLUDED.last_seen_at`;
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
    const rows = await this.sql`INSERT INTO messages (id, chat_id, group_id, sender_id, sender_name, timestamp_ms, message_type, text_or_transcript, transcript_confidence, transcript_language, quoted_message_id, quoted_sender_id, mentioned_member_ids_json, media_metadata_json, is_group, is_status, is_from_bot, stored_at)
      VALUES (${message.id}, ${message.chatId}, ${message.groupId ?? null}, ${message.senderId}, ${message.senderName ?? null}, ${message.timestamp}, ${message.type}, ${message.text ?? null}, ${message.transcriptConfidence ?? null}, ${message.transcriptLanguage ?? null}, ${message.quotedMessageId ?? null}, ${message.quotedSenderId ?? null}, ${JSON.stringify(message.mentionedIds)}::jsonb, ${message.media ? JSON.stringify(message.media) : null}::jsonb, ${message.isGroup}, ${message.isStatus}, ${message.isFromBot}, ${message.storedAt})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.messages[message.id] = message;
    return true;
  }

  async upsertMemory(memory: MemoryRecord): Promise<void> {
    await this.sql`INSERT INTO memories (id, scope_type, scope_id, memory_type, value_json, confidence, importance, status, evidence_count, created_at, last_confirmed_at, updated_at, source_message_id, source_timestamp, source_member_id, expires_at)
      VALUES (${memory.id}, ${memory.scopeType}, ${memory.scopeId}, ${memory.memoryType}, ${JSON.stringify(memory.value)}::jsonb, ${memory.confidence}, ${memory.importance}, ${memory.status}, ${memory.evidenceCount}, ${memory.createdAt}, ${memory.lastConfirmedAt}, ${memory.updatedAt}, ${memory.sourceMessageId ?? null}, ${memory.sourceTimestamp ?? null}, ${memory.sourceMemberId ?? null}, ${memory.expiresAt ?? null})
      ON CONFLICT (id) DO UPDATE SET value_json = EXCLUDED.value_json, confidence = EXCLUDED.confidence, importance = EXCLUDED.importance, status = EXCLUDED.status, evidence_count = EXCLUDED.evidence_count, last_confirmed_at = EXCLUDED.last_confirmed_at, updated_at = EXCLUDED.updated_at, source_message_id = EXCLUDED.source_message_id, source_timestamp = EXCLUDED.source_timestamp, source_member_id = EXCLUDED.source_member_id, expires_at = EXCLUDED.expires_at`;
    this.state.memories[memory.id] = memory;
  }

  async deleteMemories(scopeId: string): Promise<number> {
    const rows = await this.sql`DELETE FROM memories WHERE scope_id = ${scopeId} RETURNING id`;
    const ids = (rows as Row[]).map((row) => String(row.id));
    for (const id of ids) delete this.state.memories[id];
    return ids.length;
  }

  async enqueueMemoryVectorJob(job: MemoryVectorJobRecord): Promise<boolean> {
    const current = this.state.memoryVectorJobs[job.id];
    if (current?.status === "PROCESSING") return false;
    if (current?.memoryUpdatedAt === job.memoryUpdatedAt && current.operation === job.operation) return false;
    const rows = await this.sql`INSERT INTO memory_vector_jobs (id, memory_id, operation, memory_updated_at, status, attempts, created_at, updated_at, next_attempt_at, last_error)
      VALUES (${job.id}, ${job.memoryId}, ${job.operation}, ${job.memoryUpdatedAt}, ${job.status}, ${job.attempts}, ${job.createdAt}, ${job.updatedAt}, ${job.nextAttemptAt ?? null}, ${job.lastError ?? null})
      ON CONFLICT (memory_id) DO UPDATE SET id = EXCLUDED.id, operation = EXCLUDED.operation, memory_updated_at = EXCLUDED.memory_updated_at, status = EXCLUDED.status, attempts = EXCLUDED.attempts, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, next_attempt_at = EXCLUDED.next_attempt_at, last_error = EXCLUDED.last_error
      RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.memoryVectorJobs[job.id] = job;
    return true;
  }

  async updateMemoryVectorJob(id: string, update: Partial<MemoryVectorJobRecord>): Promise<MemoryVectorJobRecord | undefined> {
    const current = this.state.memoryVectorJobs[id];
    if (!current) return undefined;
    const job = { ...current, ...update, updatedAt: Date.now() };
    await this.sql`UPDATE memory_vector_jobs SET operation = ${job.operation}, memory_updated_at = ${job.memoryUpdatedAt}, status = ${job.status}, attempts = ${job.attempts}, updated_at = ${job.updatedAt}, next_attempt_at = ${job.nextAttemptAt ?? null}, last_error = ${job.lastError ?? null} WHERE id = ${id}`;
    this.state.memoryVectorJobs[id] = job;
    return job;
  }

  memoryVectorJobs(status?: MemoryVectorJobStatus): MemoryVectorJobRecord[] {
    return Object.values(this.state.memoryVectorJobs)
      .filter((job) => !status || job.status === status)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async createAction(action: ActionRecord): Promise<boolean> {
    const rows = await this.sql`INSERT INTO ai_actions (id, idempotency_key, group_id, source_message_id, action_type, target_message_id, payload_json, scheduled_for, status, attempts, next_attempt_at, executed_at, error)
      VALUES (${action.id}, ${action.idempotencyKey}, ${action.groupId}, ${action.sourceMessageId}, ${action.actionType}, ${action.targetMessageId ?? null}, ${JSON.stringify(action.payload)}::jsonb, ${action.scheduledFor}, ${action.status}, ${action.attempts ?? 0}, ${action.nextAttemptAt ?? null}, ${action.executedAt ?? null}, ${action.error ?? null})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.actions[action.id] = action;
    return true;
  }

  async updateAction(id: string, update: Partial<ActionRecord>): Promise<ActionRecord | undefined> {
    const current = this.state.actions[id];
    if (!current) return undefined;
    const action = { ...current, ...update };
    await this.sql`UPDATE ai_actions SET status = ${action.status}, target_message_id = ${action.targetMessageId ?? null}, payload_json = ${JSON.stringify(action.payload)}::jsonb, scheduled_for = ${action.scheduledFor}, attempts = ${action.attempts ?? 0}, next_attempt_at = ${action.nextAttemptAt ?? null}, executed_at = ${action.executedAt ?? null}, error = ${action.error ?? null} WHERE id = ${id}`;
    this.state.actions[id] = action;
    return action;
  }

  async createTask(task: TaskRecord): Promise<boolean> {
    const rows = await this.sql`INSERT INTO tasks (id, group_id, creator_id, creator_chat_id, type, condition_json, message, status, trigger_at, recurrence, notification_target, notification_chat_id, created_at, last_checked_at, last_successful_check, last_error, retry_count)
      VALUES (${task.id}, ${task.groupId}, ${task.creatorId}, ${task.creatorChatId}, ${task.type}, ${task.condition ? JSON.stringify(task.condition) : null}::jsonb, ${task.message}, ${task.status}, ${task.triggerAt ?? null}, ${task.recurrence}, ${task.notificationTarget}, ${task.notificationChatId}, ${task.createdAt}, ${task.lastCheckedAt ?? null}, ${task.lastSuccessfulCheck ?? null}, ${task.lastError ?? null}, ${task.retryCount})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.tasks[task.id] = task;
    return true;
  }

  async updateTask(id: string, update: Partial<TaskRecord>): Promise<TaskRecord | undefined> {
    const current = this.state.tasks[id];
    if (!current) return undefined;
    const task = { ...current, ...update };
    await this.sql`UPDATE tasks SET status = ${task.status}, condition_json = ${task.condition ? JSON.stringify(task.condition) : null}::jsonb, message = ${task.message}, trigger_at = ${task.triggerAt ?? null}, recurrence = ${task.recurrence}, notification_target = ${task.notificationTarget}, notification_chat_id = ${task.notificationChatId}, last_checked_at = ${task.lastCheckedAt ?? null}, last_successful_check = ${task.lastSuccessfulCheck ?? null}, last_error = ${task.lastError ?? null}, retry_count = ${task.retryCount} WHERE id = ${id}`;
    this.state.tasks[id] = task;
    return task;
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

  recentChatMessages(chatId: string, limit: number): StoredMessage[] {
    return Object.values(this.state.messages).filter((message) => message.chatId === chatId).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit).reverse();
  }

  message(id: string): StoredMessage | undefined { return this.state.messages[id]; }
  group(id: string): GroupRecord | undefined { return this.state.groups[id]; }
  groups(): GroupRecord[] { return Object.values(this.state.groups).sort((a, b) => a.subject.localeCompare(b.subject)); }
  members(groupId?: string): MemberRecord[] { return Object.values(this.state.members).filter((member) => !groupId || member.groupId === groupId); }
  memories(scopeId?: string): MemoryRecord[] { return Object.values(this.state.memories).filter((memory) => !scopeId || memory.scopeId === scopeId); }
  logs(limit = 100): AuditLog[] { return this.state.logs.slice(-limit).reverse(); }
  actions(limit = 100): ActionRecord[] { return Object.values(this.state.actions).sort((a, b) => b.scheduledFor - a.scheduledFor).slice(0, limit); }
  action(id: string): ActionRecord | undefined { return this.state.actions[id]; }
  task(id: string): TaskRecord | undefined { return this.state.tasks[id]; }
  tasks(status?: TaskStatus): TaskRecord[] { return Object.values(this.state.tasks).filter((task) => !status || task.status === status).sort((a, b) => b.createdAt - a.createdAt); }

  async createInboundJob(job: InboundJobRecord): Promise<boolean> {
    const rows = await this.sql`INSERT INTO inbound_jobs (id, message_id, chat_id, message_json, status, attempts, created_at, updated_at, next_attempt_at, last_error)
      VALUES (${job.id}, ${job.messageId}, ${job.chatId}, ${JSON.stringify(job.message)}::jsonb, ${job.status}, ${job.attempts}, ${job.createdAt}, ${job.updatedAt}, ${job.nextAttemptAt ?? null}, ${job.lastError ?? null})
      ON CONFLICT (message_id) DO NOTHING RETURNING id`;
    if (!(rows as Row[]).length) return false;
    this.state.inboundJobs[job.id] = job;
    return true;
  }

  async updateInboundJob(id: string, update: Partial<InboundJobRecord>): Promise<InboundJobRecord | undefined> {
    const current = this.state.inboundJobs[id];
    if (!current) return undefined;
    const job = { ...current, ...update, updatedAt: Date.now() };
    await this.sql`UPDATE inbound_jobs SET status = ${job.status}, message_json = ${JSON.stringify(job.message)}::jsonb, attempts = ${job.attempts}, updated_at = ${job.updatedAt}, next_attempt_at = ${job.nextAttemptAt ?? null}, last_error = ${job.lastError ?? null} WHERE id = ${id}`;
    this.state.inboundJobs[id] = job;
    return job;
  }

  inboundJobByMessageId(messageId: string): InboundJobRecord | undefined { return Object.values(this.state.inboundJobs).find((job) => job.messageId === messageId); }
  inboundJobs(status?: InboundJobStatus): InboundJobRecord[] { return Object.values(this.state.inboundJobs).filter((job) => !status || job.status === status).sort((a, b) => a.createdAt - b.createdAt); }

  async pruneExpired(retentionDays: number, now = Date.now()): Promise<PruneResult> {
    const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const [messages, memories, memoryVectorJobs, actions, logs, providerUsage, sessions, inboundJobs] = await Promise.all([
      this.sql`DELETE FROM messages WHERE stored_at < ${cutoff} RETURNING id`,
      this.sql`DELETE FROM memories WHERE (expires_at IS NOT NULL AND expires_at <= ${now}) OR last_confirmed_at < ${cutoff} RETURNING id`,
      this.sql`DELETE FROM memory_vector_jobs WHERE status NOT IN ('PENDING', 'PROCESSING') AND updated_at < ${cutoff} RETURNING id`,
      this.sql`DELETE FROM ai_actions WHERE status <> 'PENDING' AND COALESCE(executed_at, scheduled_for) < ${cutoff} RETURNING id`,
      this.sql`DELETE FROM audit_logs WHERE created_at < ${cutoff} RETURNING id`,
      this.sql`DELETE FROM provider_usage WHERE created_at < ${cutoff} RETURNING id`,
      this.sql`DELETE FROM sessions WHERE expires_at <= ${now} RETURNING token_hash`,
      this.sql`DELETE FROM inbound_jobs WHERE status NOT IN ('PENDING', 'PROCESSING') AND updated_at < ${cutoff} RETURNING id`,
    ]);
    const result: PruneResult = {
      messages: (messages as Row[]).length,
      memories: (memories as Row[]).length,
      memoryVectorJobs: (memoryVectorJobs as Row[]).length,
      actions: (actions as Row[]).length,
      logs: (logs as Row[]).length,
      providerUsage: (providerUsage as Row[]).length,
      sessions: (sessions as Row[]).length,
      inboundJobs: (inboundJobs as Row[]).length,
    };
    for (const row of messages as Row[]) delete this.state.messages[String(row.id)];
    for (const row of memories as Row[]) delete this.state.memories[String(row.id)];
    for (const row of memoryVectorJobs as Row[]) delete this.state.memoryVectorJobs[String(row.id)];
    for (const row of actions as Row[]) delete this.state.actions[String(row.id)];
    for (const row of sessions as Row[]) delete this.state.sessions[String(row.token_hash)];
    for (const row of inboundJobs as Row[]) delete this.state.inboundJobs[String(row.id)];
    this.state.logs = this.state.logs.filter((log) => log.createdAt >= cutoff);
    this.state.providerUsage = this.state.providerUsage.filter((usage) => usage.createdAt >= cutoff);
    return result;
  }

  private async createSchema(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at bigint NOT NULL)`;
     await this.sql`CREATE TABLE IF NOT EXISTS groups (id text PRIMARY KEY, whatsapp_group_id text UNIQUE NOT NULL, subject text NOT NULL, participant_count integer NOT NULL, is_admin boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false, ai_paused boolean NOT NULL DEFAULT false, learning_enabled boolean NOT NULL DEFAULT true, personality_override_json jsonb, participation_override_json jsonb, last_seen_at bigint NOT NULL)`;
     await this.sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS participation_override_json jsonb`;
     await this.sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS learning_enabled boolean NOT NULL DEFAULT true`;
    await this.sql`CREATE TABLE IF NOT EXISTS members (id text PRIMARY KEY, group_id text NOT NULL, whatsapp_member_id text NOT NULL, display_name text, behavior_profile_json jsonb NOT NULL, confidence_json jsonb NOT NULL, first_seen_at bigint NOT NULL, last_seen_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, chat_id text NOT NULL, group_id text, sender_id text NOT NULL, sender_name text, timestamp_ms bigint NOT NULL, message_type text NOT NULL, text_or_transcript text, transcript_confidence real, transcript_language text, quoted_message_id text, quoted_sender_id text, mentioned_member_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb, media_metadata_json jsonb, is_group boolean NOT NULL, is_status boolean NOT NULL, is_from_bot boolean NOT NULL, stored_at bigint NOT NULL)`;
    await this.sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcript_confidence real`;
    await this.sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcript_language text`;
    await this.sql`CREATE INDEX IF NOT EXISTS messages_group_time_idx ON messages (group_id, timestamp_ms DESC)`;
      await this.sql`CREATE TABLE IF NOT EXISTS memories (id text PRIMARY KEY, scope_type text NOT NULL, scope_id text NOT NULL, memory_type text NOT NULL, value_json jsonb NOT NULL, confidence real NOT NULL, importance real NOT NULL DEFAULT 0.5, status text NOT NULL DEFAULT 'ACTIVE', evidence_count integer NOT NULL, created_at bigint NOT NULL, last_confirmed_at bigint NOT NULL, updated_at bigint NOT NULL DEFAULT 0, source_message_id text, source_timestamp bigint, source_member_id text, expires_at bigint)`;
     await this.sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS importance real NOT NULL DEFAULT 0.5`;
     await this.sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'`;
     await this.sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS updated_at bigint NOT NULL DEFAULT 0`;
     await this.sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_message_id text`;
     await this.sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_timestamp bigint`;
     await this.sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_member_id text`;
     await this.sql`UPDATE memories SET updated_at = last_confirmed_at WHERE updated_at = 0`;
     await this.sql`CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories (scope_id)`;
      await this.sql`CREATE TABLE IF NOT EXISTS memory_vector_jobs (id text PRIMARY KEY, memory_id text UNIQUE NOT NULL, operation text NOT NULL DEFAULT 'UPSERT', memory_updated_at bigint NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 0, created_at bigint NOT NULL, updated_at bigint NOT NULL, next_attempt_at bigint, last_error text)`;
      await this.sql`ALTER TABLE memory_vector_jobs ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'UPSERT'`;
     await this.sql`CREATE INDEX IF NOT EXISTS memory_vector_jobs_status_idx ON memory_vector_jobs (status, next_attempt_at, created_at)`;
    await this.sql`CREATE TABLE IF NOT EXISTS ai_actions (id text PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, group_id text NOT NULL, source_message_id text NOT NULL, action_type text NOT NULL, target_message_id text, payload_json jsonb NOT NULL, scheduled_for bigint NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at bigint, executed_at bigint, error text)`;
    await this.sql`ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`;
    await this.sql`ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS next_attempt_at bigint`;
    await this.sql`CREATE INDEX IF NOT EXISTS actions_group_time_idx ON ai_actions (group_id, scheduled_for DESC)`;
     await this.sql`CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, group_id text NOT NULL, creator_id text NOT NULL, creator_chat_id text NOT NULL, type text NOT NULL, condition_json jsonb, message text NOT NULL, status text NOT NULL, trigger_at bigint, recurrence text NOT NULL, notification_target text NOT NULL, notification_chat_id text NOT NULL, created_at bigint NOT NULL, last_checked_at bigint, last_successful_check bigint, last_error text, retry_count integer NOT NULL DEFAULT 0)`;
     await this.sql`CREATE INDEX IF NOT EXISTS tasks_status_trigger_idx ON tasks (status, trigger_at)`;
     await this.sql`CREATE TABLE IF NOT EXISTS inbound_jobs (id text PRIMARY KEY, message_id text UNIQUE NOT NULL, chat_id text NOT NULL, message_json jsonb NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 0, created_at bigint NOT NULL, updated_at bigint NOT NULL, next_attempt_at bigint, last_error text)`;
     await this.sql`CREATE INDEX IF NOT EXISTS inbound_jobs_status_created_idx ON inbound_jobs (status, created_at)`;
    await this.sql`CREATE TABLE IF NOT EXISTS audit_logs (id text PRIMARY KEY, event text NOT NULL, level text NOT NULL, message_id text, group_id text, details_json jsonb NOT NULL, created_at bigint NOT NULL)`;
    await this.sql`CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs (created_at DESC)`;
    await this.sql`CREATE TABLE IF NOT EXISTS provider_usage (id bigserial PRIMARY KEY, provider text NOT NULL, operation text NOT NULL, group_id text, units integer NOT NULL, success boolean NOT NULL, latency_ms integer NOT NULL, created_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL, created_at bigint NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL)`;
    await this.sql`CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)`;
      await this.sql`CREATE TABLE IF NOT EXISTS app_settings (id integer PRIMARY KEY CHECK (id = 1), outbound_paused boolean NOT NULL DEFAULT false, ai_processing_paused boolean NOT NULL DEFAULT false, direct_message_allowlist_json jsonb NOT NULL DEFAULT '[]'::jsonb, personality_json jsonb NOT NULL DEFAULT '{}'::jsonb, participation_json jsonb NOT NULL DEFAULT '{}'::jsonb)`;
      await this.sql`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS direct_message_allowlist_json jsonb NOT NULL DEFAULT '[]'::jsonb`;
      await this.sql`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS participation_json jsonb NOT NULL DEFAULT '{}'::jsonb`;
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
  const participation = jsonObject(row.participation_override_json, {});
  return {
    id: String(row.id), whatsappGroupId: String(row.whatsapp_group_id), subject: String(row.subject), participantCount: Number(row.participant_count), isAdmin: Boolean(row.is_admin), enabled: Boolean(row.enabled), aiPaused: Boolean(row.ai_paused),
    ...(Object.keys(personality).length ? { personalityOverride: personality } : {}),
    ...(Object.keys(participation).length ? { participationOverride: participation } : {}), learningEnabled: row.learning_enabled === undefined || row.learning_enabled === null ? true : Boolean(row.learning_enabled), lastSeenAt: Number(row.last_seen_at),
  };
}

function memberFromRow(row: Row): MemberRecord {
  return { id: String(row.id), groupId: String(row.group_id), whatsappMemberId: String(row.whatsapp_member_id), ...(row.display_name ? { displayName: String(row.display_name) } : {}), behaviorProfile: jsonObject(row.behavior_profile_json, {}) as MemberRecord["behaviorProfile"], confidence: jsonObject(row.confidence_json, {}) as Record<string, number>, firstSeenAt: Number(row.first_seen_at), lastSeenAt: Number(row.last_seen_at) };
}

function messageFromRow(row: Row): StoredMessage {
  const media = jsonObject(row.media_metadata_json, {});
  return { id: String(row.id), chatId: String(row.chat_id), ...(row.group_id ? { groupId: String(row.group_id) } : {}), senderId: String(row.sender_id), ...(row.sender_name ? { senderName: String(row.sender_name) } : {}), timestamp: Number(row.timestamp_ms), type: String(row.message_type) as StoredMessage["type"], ...(row.text_or_transcript ? { text: String(row.text_or_transcript) } : {}), ...(row.transcript_confidence !== null && row.transcript_confidence !== undefined ? { transcriptConfidence: Number(row.transcript_confidence) } : {}), ...(row.transcript_language ? { transcriptLanguage: String(row.transcript_language) } : {}), ...(row.quoted_message_id ? { quotedMessageId: String(row.quoted_message_id) } : {}), ...(row.quoted_sender_id ? { quotedSenderId: String(row.quoted_sender_id) } : {}), mentionedIds: jsonArray(row.mentioned_member_ids_json), ...(Object.keys(media).length ? { media: media as unknown as StoredMessage["media"] } : {}), isGroup: Boolean(row.is_group), isStatus: Boolean(row.is_status), isFromBot: Boolean(row.is_from_bot), storedAt: Number(row.stored_at) };
}

function memoryFromRow(row: Row): MemoryRecord {
  return { id: String(row.id), scopeType: String(row.scope_type) as MemoryRecord["scopeType"], scopeId: String(row.scope_id), memoryType: String(row.memory_type), value: jsonObject(row.value_json, {}), confidence: Number(row.confidence), importance: Number(row.importance ?? 0.5), status: String(row.status ?? "ACTIVE") as MemoryRecord["status"], evidenceCount: Number(row.evidence_count), createdAt: Number(row.created_at), lastConfirmedAt: Number(row.last_confirmed_at), updatedAt: Number(row.updated_at ?? row.last_confirmed_at), ...(row.source_message_id ? { sourceMessageId: String(row.source_message_id) } : {}), ...(row.source_timestamp ? { sourceTimestamp: Number(row.source_timestamp) } : {}), ...(row.source_member_id ? { sourceMemberId: String(row.source_member_id) } : {}), ...(row.expires_at ? { expiresAt: Number(row.expires_at) } : {}) };
}

function memoryVectorJobFromRow(row: Row): MemoryVectorJobRecord {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    operation: String(row.operation ?? "UPSERT") as MemoryVectorJobRecord["operation"],
    memoryUpdatedAt: Number(row.memory_updated_at),
    status: String(row.status) as MemoryVectorJobRecord["status"],
    attempts: Number(row.attempts),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.next_attempt_at ? { nextAttemptAt: Number(row.next_attempt_at) } : {}),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  };
}

function actionFromRow(row: Row): ActionRecord {
  return { id: String(row.id), idempotencyKey: String(row.idempotency_key), groupId: String(row.group_id), sourceMessageId: String(row.source_message_id), actionType: String(row.action_type) as ActionRecord["actionType"], ...(row.target_message_id ? { targetMessageId: String(row.target_message_id) } : {}), payload: jsonObject(row.payload_json, {}), scheduledFor: Number(row.scheduled_for), status: String(row.status) as ActionRecord["status"], ...(row.attempts !== null && row.attempts !== undefined ? { attempts: Number(row.attempts) } : {}), ...(row.next_attempt_at ? { nextAttemptAt: Number(row.next_attempt_at) } : {}), ...(row.executed_at ? { executedAt: Number(row.executed_at) } : {}), ...(row.error ? { error: String(row.error) } : {}) };
}

function taskFromRow(row: Row): TaskRecord {
  const condition = jsonObject(row.condition_json, {});
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    creatorId: String(row.creator_id),
    creatorChatId: String(row.creator_chat_id),
    type: String(row.type) as TaskRecord["type"],
    ...(Object.keys(condition).length ? { condition: condition as TaskRecord["condition"] } : {}),
    message: String(row.message),
    status: String(row.status) as TaskRecord["status"],
    ...(row.trigger_at ? { triggerAt: Number(row.trigger_at) } : {}),
    recurrence: String(row.recurrence) as TaskRecord["recurrence"],
    notificationTarget: String(row.notification_target) as TaskRecord["notificationTarget"],
    notificationChatId: String(row.notification_chat_id),
    createdAt: Number(row.created_at),
    ...(row.last_checked_at ? { lastCheckedAt: Number(row.last_checked_at) } : {}),
    ...(row.last_successful_check ? { lastSuccessfulCheck: Number(row.last_successful_check) } : {}),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
    retryCount: Number(row.retry_count),
  };
}

function inboundJobFromRow(row: Row): InboundJobRecord {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    chatId: String(row.chat_id),
    message: jsonObject(row.message_json, {}) as unknown as InboundJobRecord["message"],
    status: String(row.status) as InboundJobRecord["status"],
    attempts: Number(row.attempts),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.next_attempt_at ? { nextAttemptAt: Number(row.next_attempt_at) } : {}),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  };
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
