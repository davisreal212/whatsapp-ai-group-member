import { randomUUID } from "node:crypto";
import type { EmbeddingProvider, VectorMemoryProvider } from "./vector-memory.js";
import type { MemoryRecord, MemoryVectorJobRecord, MemoryVectorJobStatus, SemanticMemoryHit } from "./types.js";
import type { Store } from "./store.js";

const CHECK_INTERVAL_MS = 15_000;
const BATCH_SIZE = 4;
const STALE_JOB_MS = 10 * 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;

export interface MemoryVectorWorkerOptions {
  checkIntervalMs?: number;
  batchSize?: number;
  staleJobMs?: number;
}

export class MemoryVectorWorker {
  private timer?: ReturnType<typeof setInterval>;
  private activeRun?: Promise<void>;
  private lastRunAt?: number;
  private lastError?: string;
  private collectionReady = false;
  private readonly checkIntervalMs: number;
  private readonly batchSize: number;
  private readonly staleJobMs: number;

  constructor(
    private readonly store: Store,
    private readonly embedding: EmbeddingProvider | undefined,
    private readonly vector: VectorMemoryProvider,
    options: MemoryVectorWorkerOptions = {},
  ) {
    this.checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
    this.batchSize = Math.max(1, options.batchSize ?? BATCH_SIZE);
    this.staleJobMs = Math.max(1_000, options.staleJobMs ?? STALE_JOB_MS);
  }

  get enabled(): boolean {
    return Boolean(this.embedding?.available && this.vector.available);
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => void this.runSafely(), this.checkIntervalMs);
    void this.runSafely();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeRun;
  }

  health(): Record<string, unknown> {
    const jobs = this.store.memoryVectorJobs();
    return {
      running: Boolean(this.timer),
      enabled: this.enabled,
      embeddingProvider: this.embedding?.name ?? "none",
      vectorProvider: this.vector.name,
      collectionReady: this.collectionReady,
      queue: {
        pending: countJobs(jobs, "PENDING"),
        processing: countJobs(jobs, "PROCESSING"),
        failed: countJobs(jobs, "FAILED"),
        completed: countJobs(jobs, "COMPLETED"),
      },
      ...(this.lastRunAt ? { lastRunAt: this.lastRunAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async enqueue(memory: MemoryRecord): Promise<void> {
    if (!this.enabled) return;
    await this.enqueueJob({
      id: memory.id,
      memoryId: memory.id,
      operation: "UPSERT",
      memoryUpdatedAt: memory.updatedAt,
      status: "PENDING",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async enqueueDeletion(memoryId: string): Promise<void> {
    if (!this.enabled) return;
    const now = Date.now();
    await this.enqueueJob({
      id: memoryId,
      memoryId,
      operation: "DELETE",
      memoryUpdatedAt: now,
      status: "PENDING",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async retrieve(query: string, scopeId: string, limit = 5): Promise<SemanticMemoryHit[]> {
    if (!this.enabled || !this.embedding || !query.trim() || !scopeId) return [];
    try {
      await this.ensureCollection();
      const vector = await this.embedding.embed(query.trim().slice(0, 8_000));
      return await this.vector.search(vector, { scopeId }, Math.max(1, Math.min(20, limit)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "memory vector search failed";
      this.lastError = message;
      await this.store.addLog({
        id: randomUUID(),
        event: "memory_vector.search_failed",
        level: "warn",
        details: { scopeId, error: message },
        createdAt: Date.now(),
      }).catch(() => undefined);
      return [];
    }
  }

  async runOnce(now = Date.now()): Promise<void> {
    if (!this.enabled || this.activeRun) return;
    const run = this.process(now);
    this.activeRun = run;
    try {
      await run;
    } finally {
      if (this.activeRun === run) this.activeRun = undefined;
    }
  }

  private async runSafely(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "memory vector worker failed";
    }
  }

  private async process(now: number): Promise<void> {
    this.lastRunAt = now;
    this.lastError = undefined;
    if (!this.embedding) return;
    await this.ensureCollection();

    const jobs = this.store.memoryVectorJobs()
      .filter((job) => (job.status === "PENDING" || job.status === "FAILED" || (job.status === "PROCESSING" && job.updatedAt + this.staleJobMs <= now)) && (job.nextAttemptAt ?? 0) <= now)
      .slice(0, this.batchSize);
    for (const job of jobs) await this.processJob(job, now);
  }

  private async processJob(job: MemoryVectorJobRecord, now: number): Promise<void> {
    const claimed = await this.store.updateMemoryVectorJob(job.id, {
      status: "PROCESSING",
      attempts: job.attempts + 1,
      nextAttemptAt: undefined,
      lastError: undefined,
    });
    if (!claimed) return;

    try {
      const memory = this.store.memories().find((item) => item.id === job.memoryId);
      if (job.operation === "DELETE") {
        if (memory) {
          await this.store.updateMemoryVectorJob(job.id, { operation: "UPSERT", memoryUpdatedAt: memory.updatedAt, status: "PENDING", attempts: 0 });
          return;
        }
        await this.vector.delete(job.memoryId);
      } else {
        if (!memory) {
          await this.vector.delete(job.memoryId);
        } else if (memory.updatedAt !== job.memoryUpdatedAt) {
          await this.store.updateMemoryVectorJob(job.id, { memoryUpdatedAt: memory.updatedAt, status: "PENDING", attempts: 0 });
          return;
        } else {
          const vector = await this.embedding?.embed(memoryText(memory));
          if (!vector) throw new Error("embedding provider is unavailable");
          await this.vector.upsert(memory, vector);
          const latest = this.store.memories().find((item) => item.id === job.memoryId);
          if (latest && latest.updatedAt !== job.memoryUpdatedAt) {
            await this.store.updateMemoryVectorJob(job.id, { memoryUpdatedAt: latest.updatedAt, status: "PENDING", attempts: 0 });
            return;
          }
        }
      }
      await this.store.updateMemoryVectorJob(job.id, { status: "COMPLETED", nextAttemptAt: undefined, lastError: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : "memory vector operation failed";
      const nextAttemptAt = now + retryDelay(claimed.attempts);
      await this.store.updateMemoryVectorJob(job.id, { status: "FAILED", nextAttemptAt, lastError: message });
      this.lastError = message;
      await this.store.addLog({
        id: randomUUID(),
        event: "memory_vector.failed",
        level: "warn",
        details: { memoryId: job.memoryId, operation: job.operation, attempts: claimed.attempts, error: message },
        createdAt: Date.now(),
      }).catch(() => undefined);
    }
  }

  private async enqueueJob(job: MemoryVectorJobRecord): Promise<void> {
    try {
      await this.store.enqueueMemoryVectorJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "memory vector enqueue failed";
      this.lastError = message;
      await this.store.addLog({
        id: randomUUID(),
        event: "memory_vector.enqueue_failed",
        level: "warn",
        details: { memoryId: job.memoryId, operation: job.operation, error: message },
        createdAt: Date.now(),
      }).catch(() => undefined);
    }
  }

  private async ensureCollection(): Promise<void> {
    if (this.collectionReady) return;
    await this.vector.ensureCollection();
    this.collectionReady = true;
  }
}

function memoryText(memory: MemoryRecord): string {
  return `${memory.memoryType} ${memory.scopeType}: ${JSON.stringify(memory.value)}`.slice(0, 8_000);
}

function retryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(10, Math.max(0, attempts - 1)));
}

function countJobs(jobs: MemoryVectorJobRecord[], status: MemoryVectorJobStatus): number {
  return jobs.filter((job) => job.status === status).length;
}
