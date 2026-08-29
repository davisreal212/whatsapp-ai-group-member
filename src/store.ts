import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  StoredMessage,
  SessionRecord,
  UserRecord,
} from "./types.js";

export interface Store {
  readonly snapshot: PersistedState;
  init(): Promise<void>;
  setConnection(status: ConnectionStatus, pairingCode?: string): Promise<void>;
  settings(): PersistedState["settings"];
  updateSettings(update: NonNullable<PersistedState["settings"]>): Promise<void>;
  updateMetrics(update: Partial<AppMetrics>): Promise<void>;
  incrementMetric(key: keyof AppMetrics, amount?: number): Promise<void>;
  upsertGroup(group: GroupRecord): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  updateGroup(id: string, update: Partial<GroupRecord>): Promise<GroupRecord | undefined>;
  upsertMember(member: MemberRecord): Promise<void>;
  storeMessage(message: StoredMessage): Promise<boolean>;
  upsertMemory(memory: MemoryRecord): Promise<void>;
  deleteMemories(scopeId: string): Promise<number>;
  createAction(action: ActionRecord): Promise<boolean>;
  updateAction(id: string, update: Partial<ActionRecord>): Promise<ActionRecord | undefined>;
  addLog(log: AuditLog): Promise<void>;
  addProviderUsage(usage: ProviderUsageRecord): Promise<void>;
  createUser(user: UserRecord): Promise<boolean>;
  userByEmail(email: string): UserRecord | undefined;
  userById(id: string): UserRecord | undefined;
  userCount(): number;
  createSession(session: SessionRecord): Promise<void>;
  sessionByTokenHash(tokenHash: string): SessionRecord | undefined;
  deleteSession(tokenHash: string): Promise<void>;
  recentMessages(groupId: string, limit: number): StoredMessage[];
  message(id: string): StoredMessage | undefined;
  group(id: string): GroupRecord | undefined;
  groups(): GroupRecord[];
  members(groupId?: string): MemberRecord[];
  memories(scopeId?: string): MemoryRecord[];
  logs(limit?: number): AuditLog[];
  actions(limit?: number): ActionRecord[];
  pruneExpired(retentionDays: number, now?: number): Promise<PruneResult>;
}

export interface PruneResult {
  messages: number;
  memories: number;
  actions: number;
  logs: number;
  providerUsage: number;
  sessions: number;
}

export const emptyMetrics = (): AppMetrics => ({
  observed: 0,
  ignoredLocally: 0,
  aiCalls: 0,
  webSearches: 0,
  providerFailures: 0,
  actionsSent: 0,
  actionsSkipped: 0,
  actionFailures: 0,
});

export const emptyState = (): PersistedState => ({
  groups: {},
  members: {},
  messages: {},
  memories: {},
  actions: {},
  logs: [],
  providerUsage: [],
  users: {},
  sessions: {},
  runtime: { connectionStatus: "DISCONNECTED", metrics: emptyMetrics() },
});

export class FileStore implements Store {
  private state: PersistedState = emptyState();
  private initialized = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "state.json");
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = { ...emptyState(), ...JSON.parse(raw) } as PersistedState;
      this.state.users = { ...emptyState().users, ...this.state.users };
      this.state.sessions = { ...emptyState().sessions, ...this.state.sessions };
      this.state.runtime = {
        ...emptyState().runtime,
        ...this.state.runtime,
        metrics: { ...emptyMetrics(), ...this.state.runtime?.metrics },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
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
    await this.persist();
  }

  settings(): PersistedState["settings"] {
    return this.state.settings;
  }

  async updateSettings(update: NonNullable<PersistedState["settings"]>): Promise<void> {
    this.state.settings = { ...this.state.settings, ...update, ...(update.personality ? { personality: { ...this.state.settings?.personality, ...update.personality } } : {}) };
    await this.persist();
  }

  async updateMetrics(update: Partial<AppMetrics>): Promise<void> {
    this.state.runtime.metrics = { ...this.state.runtime.metrics, ...update };
    await this.persist();
  }

  async incrementMetric(key: keyof AppMetrics, amount = 1): Promise<void> {
    this.state.runtime.metrics[key] += amount;
    await this.persist();
  }

  async upsertGroup(group: GroupRecord): Promise<void> {
    this.state.groups[group.id] = group;
    await this.persist();
  }

  async deleteGroup(id: string): Promise<void> {
    delete this.state.groups[id];
    for (const [memberId, member] of Object.entries(this.state.members)) {
      if (member.groupId === id) delete this.state.members[memberId];
    }
    await this.persist();
  }

  async updateGroup(id: string, update: Partial<GroupRecord>): Promise<GroupRecord | undefined> {
    const group = this.state.groups[id];
    if (!group) return undefined;
    this.state.groups[id] = { ...group, ...update };
    await this.persist();
    return this.state.groups[id];
  }

  async upsertMember(member: MemberRecord): Promise<void> {
    this.state.members[member.id] = member;
    await this.persist();
  }

  async storeMessage(message: StoredMessage): Promise<boolean> {
    if (this.state.messages[message.id]) return false;
    this.state.messages[message.id] = message;
    await this.persist();
    return true;
  }

  async upsertMemory(memory: MemoryRecord): Promise<void> {
    this.state.memories[memory.id] = memory;
    await this.persist();
  }

  async deleteMemories(scopeId: string): Promise<number> {
    const ids = Object.values(this.state.memories)
      .filter((memory) => memory.scopeId === scopeId)
      .map((memory) => memory.id);
    for (const id of ids) delete this.state.memories[id];
    await this.persist();
    return ids.length;
  }

  async createAction(action: ActionRecord): Promise<boolean> {
    if (Object.values(this.state.actions).some((item) => item.idempotencyKey === action.idempotencyKey)) {
      return false;
    }
    this.state.actions[action.id] = action;
    await this.persist();
    return true;
  }

  async updateAction(id: string, update: Partial<ActionRecord>): Promise<ActionRecord | undefined> {
    const action = this.state.actions[id];
    if (!action) return undefined;
    this.state.actions[id] = { ...action, ...update };
    await this.persist();
    return this.state.actions[id];
  }

  async addLog(log: AuditLog): Promise<void> {
    this.state.logs.push(log);
    this.state.logs = this.state.logs.slice(-500);
    await this.persist();
  }

  async addProviderUsage(usage: ProviderUsageRecord): Promise<void> {
    this.state.providerUsage.push(usage);
    this.state.providerUsage = this.state.providerUsage.slice(-1000);
    await this.persist();
  }

  async createUser(user: UserRecord): Promise<boolean> {
    if (Object.values(this.state.users).some((item) => item.email === user.email)) return false;
    this.state.users[user.id] = user;
    await this.persist();
    return true;
  }

  userByEmail(email: string): UserRecord | undefined {
    return Object.values(this.state.users).find((user) => user.email === email);
  }

  userById(id: string): UserRecord | undefined {
    return this.state.users[id];
  }

  userCount(): number {
    return Object.keys(this.state.users).length;
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.state.sessions[session.tokenHash] = session;
    await this.persist();
  }

  sessionByTokenHash(tokenHash: string): SessionRecord | undefined {
    return this.state.sessions[tokenHash];
  }

  async deleteSession(tokenHash: string): Promise<void> {
    delete this.state.sessions[tokenHash];
    await this.persist();
  }

  recentMessages(groupId: string, limit: number): StoredMessage[] {
    return Object.values(this.state.messages)
      .filter((message) => message.groupId === groupId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .reverse();
  }

  message(id: string): StoredMessage | undefined {
    return this.state.messages[id];
  }

  group(id: string): GroupRecord | undefined {
    return this.state.groups[id];
  }

  groups(): GroupRecord[] {
    return Object.values(this.state.groups).sort((a, b) => a.subject.localeCompare(b.subject));
  }

  members(groupId?: string): MemberRecord[] {
    return Object.values(this.state.members).filter((member) => !groupId || member.groupId === groupId);
  }

  memories(scopeId?: string): MemoryRecord[] {
    return Object.values(this.state.memories).filter((memory) => !scopeId || memory.scopeId === scopeId);
  }

  logs(limit = 100): AuditLog[] {
    return this.state.logs.slice(-limit).reverse();
  }

  actions(limit = 100): ActionRecord[] {
    return Object.values(this.state.actions)
      .sort((a, b) => b.scheduledFor - a.scheduledFor)
      .slice(0, limit);
  }

  async pruneExpired(retentionDays: number, now = Date.now()): Promise<PruneResult> {
    const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const result: PruneResult = { messages: 0, memories: 0, actions: 0, logs: 0, providerUsage: 0, sessions: 0 };
    for (const [id, message] of Object.entries(this.state.messages)) {
      if (message.storedAt < cutoff) {
        delete this.state.messages[id];
        result.messages += 1;
      }
    }
    for (const [id, memory] of Object.entries(this.state.memories)) {
      if ((memory.expiresAt !== undefined && memory.expiresAt <= now) || memory.lastConfirmedAt < cutoff) {
        delete this.state.memories[id];
        result.memories += 1;
      }
    }
    for (const [id, action] of Object.entries(this.state.actions)) {
      if (action.status !== "PENDING" && (action.executedAt ?? action.scheduledFor) < cutoff) {
        delete this.state.actions[id];
        result.actions += 1;
      }
    }
    const originalLogs = this.state.logs.length;
    this.state.logs = this.state.logs.filter((log) => log.createdAt >= cutoff);
    result.logs = originalLogs - this.state.logs.length;
    const originalUsage = this.state.providerUsage.length;
    this.state.providerUsage = this.state.providerUsage.filter((usage) => usage.createdAt >= cutoff);
    result.providerUsage = originalUsage - this.state.providerUsage.length;
    for (const [tokenHash, session] of Object.entries(this.state.sessions)) {
      if (session.expiresAt <= now) {
        delete this.state.sessions[tokenHash];
        result.sessions += 1;
      }
    }
    if (Object.values(result).some((count) => count > 0)) await this.persist();
    return result;
  }

  private async persist(): Promise<void> {
    const operation = this.persistQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(this.state, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
    });
    this.persistQueue = operation.catch(() => undefined);
    await operation;
  }
}
