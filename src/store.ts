import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  MemoryVectorJobExpectation,
  MemoryVectorJobRecord,
  MemoryVectorJobStatus,
  PersistedState,
  ProviderUsageRecord,
  StoredMessage,
  SessionRecord,
  TaskRecord,
  TaskStatus,
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
  deleteMemory(id: string): Promise<boolean>;
  deleteMemories(scopeId: string): Promise<number>;
  deleteAllMemories(): Promise<number>;
  enqueueMemoryVectorJob(job: MemoryVectorJobRecord, options?: { force?: boolean }): Promise<boolean>;
  updateMemoryVectorJob(id: string, update: Partial<MemoryVectorJobRecord>, expected?: MemoryVectorJobExpectation): Promise<MemoryVectorJobRecord | undefined>;
  memoryVectorJobs(status?: MemoryVectorJobStatus): MemoryVectorJobRecord[];
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
  recentChatMessages(chatId: string, limit: number): StoredMessage[];
  countMessages(scopeId: string): number;
  message(id: string): StoredMessage | undefined;
  group(id: string): GroupRecord | undefined;
  groups(): GroupRecord[];
  members(groupId?: string): MemberRecord[];
  memories(scopeId?: string): MemoryRecord[];
  logs(limit?: number): AuditLog[];
  actions(limit?: number): ActionRecord[];
  action(id: string): ActionRecord | undefined;
  createTask(task: TaskRecord): Promise<boolean>;
  updateTask(id: string, update: Partial<TaskRecord>): Promise<TaskRecord | undefined>;
  task(id: string): TaskRecord | undefined;
  tasks(status?: TaskStatus): TaskRecord[];
  createInboundJob(job: InboundJobRecord): Promise<boolean>;
  updateInboundJob(id: string, update: Partial<InboundJobRecord>): Promise<InboundJobRecord | undefined>;
  inboundJobByMessageId(messageId: string): InboundJobRecord | undefined;
  inboundJobs(status?: InboundJobStatus): InboundJobRecord[];
  pruneExpired(retentionDays: number, now?: number): Promise<PruneResult>;
}

export interface PruneResult {
  messages: number;
  memories: number;
  memoryVectorJobs: number;
  actions: number;
  logs: number;
  providerUsage: number;
  sessions: number;
  inboundJobs: number;
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
  memoryVectorJobs: {},
  actions: {},
  tasks: {},
  inboundJobs: {},
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

  constructor(dataDir: string, private readonly vectorJobsEnabled = false) {
    this.filePath = join(dataDir, "state.json");
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = { ...emptyState(), ...JSON.parse(raw) } as PersistedState;
      this.state.inboundJobs = { ...emptyState().inboundJobs, ...this.state.inboundJobs };
      this.state.memoryVectorJobs = { ...emptyState().memoryVectorJobs, ...this.state.memoryVectorJobs };
      this.state.users = { ...emptyState().users, ...this.state.users };
      this.state.sessions = { ...emptyState().sessions, ...this.state.sessions };
      this.state.runtime = {
        ...emptyState().runtime,
        ...this.state.runtime,
        metrics: { ...emptyMetrics(), ...this.state.runtime?.metrics },
      };
      this.state.memories = Object.fromEntries(Object.entries(this.state.memories).map(([id, memory]) => [id, normalizeMemory(memory)]));
      this.state.memoryVectorJobs = Object.fromEntries(Object.entries(this.state.memoryVectorJobs).map(([id, job]) => [id, normalizeMemoryVectorJob(job)]));
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
    this.state.settings = {
      ...this.state.settings,
      ...update,
      ...(update.personality ? { personality: { ...this.state.settings?.personality, ...update.personality } } : {}),
      ...(update.participation ? { participation: { ...this.state.settings?.participation, ...update.participation } } : {}),
    };
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
    const memoryIds = Object.values(this.state.memories)
      .filter((memory) => memory.scopeId === id || (memory.scopeType === "member" && memory.scopeId.startsWith(`${id}:`)))
      .map((memory) => memory.id);
    delete this.state.groups[id];
    for (const [memberId, member] of Object.entries(this.state.members)) {
      if (member.groupId === id) delete this.state.members[memberId];
    }
    for (const memoryId of memoryIds) {
      delete this.state.memories[memoryId];
      this.queueMemoryVectorDelete(memoryId);
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
    const normalized = normalizeMemory(memory);
    this.state.memories[memory.id] = normalized;
    if (this.vectorJobsEnabled) this.queueMemoryVectorUpsert(normalized);
    await this.persist();
  }

  async deleteMemory(id: string): Promise<boolean> {
    if (!this.state.memories[id]) return false;
    delete this.state.memories[id];
    this.queueMemoryVectorDelete(id);
    await this.persist();
    return true;
  }

  async deleteMemories(scopeId: string): Promise<number> {
    const ids = Object.values(this.state.memories)
      .filter((memory) => memory.scopeId === scopeId)
      .map((memory) => memory.id);
    for (const id of ids) {
      delete this.state.memories[id];
      this.queueMemoryVectorDelete(id);
    }
    await this.persist();
    return ids.length;
  }

  async deleteAllMemories(): Promise<number> {
    const ids = Object.keys(this.state.memories);
    for (const id of ids) {
      delete this.state.memories[id];
      this.queueMemoryVectorDelete(id);
    }
    if (ids.length) await this.persist();
    return ids.length;
  }

  async enqueueMemoryVectorJob(job: MemoryVectorJobRecord, options: { force?: boolean } = {}): Promise<boolean> {
    const current = this.state.memoryVectorJobs[job.id];
    if (current?.status === "PROCESSING" && current.memoryUpdatedAt === job.memoryUpdatedAt && current.operation === job.operation) return false;
    if (!options.force && current?.status === "COMPLETED" && current.memoryUpdatedAt === job.memoryUpdatedAt && current.operation === job.operation) return false;
    this.state.memoryVectorJobs[job.id] = job;
    await this.persist();
    return true;
  }

  async updateMemoryVectorJob(id: string, update: Partial<MemoryVectorJobRecord>, expected?: MemoryVectorJobExpectation): Promise<MemoryVectorJobRecord | undefined> {
    const job = this.state.memoryVectorJobs[id];
    if (!job || (expected && !matchesMemoryVectorJob(job, expected))) return undefined;
    this.state.memoryVectorJobs[id] = { ...job, ...update, updatedAt: Date.now() };
    await this.persist();
    return this.state.memoryVectorJobs[id];
  }

  memoryVectorJobs(status?: MemoryVectorJobStatus): MemoryVectorJobRecord[] {
    return Object.values(this.state.memoryVectorJobs)
      .filter((job) => !status || job.status === status)
      .sort((a, b) => a.createdAt - b.createdAt);
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

  async createTask(task: TaskRecord): Promise<boolean> {
    if (this.state.tasks[task.id]) return false;
    this.state.tasks[task.id] = task;
    await this.persist();
    return true;
  }

  async updateTask(id: string, update: Partial<TaskRecord>): Promise<TaskRecord | undefined> {
    const task = this.state.tasks[id];
    if (!task) return undefined;
    this.state.tasks[id] = { ...task, ...update };
    await this.persist();
    return this.state.tasks[id];
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
    return this.recentMessagesBy((message) => message.groupId === groupId, limit);
  }

  recentChatMessages(chatId: string, limit: number): StoredMessage[] {
    return this.recentMessagesBy((message) => message.chatId === chatId, limit);
  }

  countMessages(scopeId: string): number {
    return Object.values(this.state.messages).filter((message) => message.groupId === scopeId || (!scopeId.endsWith("@g.us") && message.chatId === scopeId)).length;
  }

  private recentMessagesBy(matches: (message: StoredMessage) => boolean, limit: number): StoredMessage[] {
    return Object.values(this.state.messages)
      .filter(matches)
      .sort(compareStoredMessagesDesc)
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

  action(id: string): ActionRecord | undefined {
    return this.state.actions[id];
  }

  task(id: string): TaskRecord | undefined {
    return this.state.tasks[id];
  }

  tasks(status?: TaskStatus): TaskRecord[] {
    return Object.values(this.state.tasks)
      .filter((task) => !status || task.status === status)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async createInboundJob(job: InboundJobRecord): Promise<boolean> {
    if (this.state.inboundJobs[job.id] || this.inboundJobByMessageId(job.messageId)) return false;
    this.state.inboundJobs[job.id] = job;
    await this.persist();
    return true;
  }

  async updateInboundJob(id: string, update: Partial<InboundJobRecord>): Promise<InboundJobRecord | undefined> {
    const job = this.state.inboundJobs[id];
    if (!job) return undefined;
    this.state.inboundJobs[id] = { ...job, ...update, updatedAt: Date.now() };
    await this.persist();
    return this.state.inboundJobs[id];
  }

  inboundJobByMessageId(messageId: string): InboundJobRecord | undefined {
    return Object.values(this.state.inboundJobs).find((job) => job.messageId === messageId);
  }

  inboundJobs(status?: InboundJobStatus): InboundJobRecord[] {
    return Object.values(this.state.inboundJobs)
      .filter((job) => !status || job.status === status)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async pruneExpired(retentionDays: number, now = Date.now()): Promise<PruneResult> {
    const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const result: PruneResult = { messages: 0, memories: 0, memoryVectorJobs: 0, actions: 0, logs: 0, providerUsage: 0, sessions: 0, inboundJobs: 0 };
    for (const [id, message] of Object.entries(this.state.messages)) {
      if (message.storedAt < cutoff) {
        delete this.state.messages[id];
        result.messages += 1;
      }
    }
    for (const [id, memory] of Object.entries(this.state.memories)) {
      if ((memory.expiresAt !== undefined && memory.expiresAt <= now) || memory.lastConfirmedAt < cutoff) {
        delete this.state.memories[id];
        this.queueMemoryVectorDelete(id, now);
        result.memories += 1;
      }
    }
    for (const [id, action] of Object.entries(this.state.actions)) {
      if (action.status !== "PENDING" && (action.executedAt ?? action.scheduledFor) < cutoff) {
        delete this.state.actions[id];
        result.actions += 1;
      }
    }
    for (const [id, job] of Object.entries(this.state.memoryVectorJobs)) {
      if (job.status !== "PENDING" && job.status !== "PROCESSING" && job.updatedAt < cutoff) {
        delete this.state.memoryVectorJobs[id];
        result.memoryVectorJobs += 1;
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
    for (const [id, job] of Object.entries(this.state.inboundJobs)) {
      if (job.status !== "PENDING" && job.status !== "PROCESSING" && job.updatedAt < cutoff) {
        delete this.state.inboundJobs[id];
        result.inboundJobs += 1;
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

  private queueMemoryVectorDelete(memoryId: string, now = Date.now()): void {
    const current = this.state.memoryVectorJobs[memoryId];
    if (current?.status === "COMPLETED" && current.operation === "DELETE") return;
    this.state.memoryVectorJobs[memoryId] = {
      id: current?.id ?? memoryId,
      memoryId,
      operation: "DELETE",
      memoryUpdatedAt: now,
      status: "PENDING",
      attempts: 0,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private queueMemoryVectorUpsert(memory: MemoryRecord, now = Date.now()): void {
    const current = this.state.memoryVectorJobs[memory.id];
    if (current?.status === "PROCESSING" && current.memoryUpdatedAt === memory.updatedAt && current.operation === "UPSERT") return;
    if (current?.status === "COMPLETED" && current.memoryUpdatedAt === memory.updatedAt && current.operation === "UPSERT") return;
    this.state.memoryVectorJobs[memory.id] = {
      id: current?.id ?? memory.id,
      memoryId: memory.id,
      operation: "UPSERT",
      memoryUpdatedAt: memory.updatedAt,
      status: "PENDING",
      attempts: 0,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
  }
}

function compareStoredMessagesDesc(left: StoredMessage, right: StoredMessage): number {
  return right.timestamp - left.timestamp || right.storedAt - left.storedAt || right.id.localeCompare(left.id);
}

function normalizeMemory(memory: MemoryRecord): MemoryRecord {
  const importance = Number(memory.importance);
  const updatedAt = Number(memory.updatedAt);
  const status = ["ACTIVE", "WEAK", "STALE", "ARCHIVED", "DELETED"].includes(memory.status) ? memory.status : "ACTIVE";
  return {
    ...memory,
    importance: Number.isFinite(importance) ? Math.min(1, Math.max(0, importance)) : 0.5,
    status,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : memory.lastConfirmedAt || memory.createdAt,
  };
}

function normalizeMemoryVectorJob(job: MemoryVectorJobRecord): MemoryVectorJobRecord {
  const operation = job.operation === "DELETE" ? "DELETE" : "UPSERT";
  const status = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"].includes(job.status) ? job.status : "PENDING";
  return {
    ...job,
    operation,
    status,
    memoryUpdatedAt: Number.isFinite(Number(job.memoryUpdatedAt)) ? Number(job.memoryUpdatedAt) : 0,
  };
}

function matchesMemoryVectorJob(job: MemoryVectorJobRecord, expected: import("./types.js").MemoryVectorJobExpectation): boolean {
  return job.operation === expected.operation && job.memoryUpdatedAt === expected.memoryUpdatedAt && job.status === expected.status && job.attempts === expected.attempts;
}
