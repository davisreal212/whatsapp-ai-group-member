import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryVectorWorker } from "../src/memory-vector-worker.js";
import { FileStore } from "../src/store.js";
import type { EmbeddingProvider, VectorMemoryProvider } from "../src/vector-memory.js";
import type { MemoryRecord } from "../src/types.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const memory: MemoryRecord = {
  id: "memory-1",
  scopeType: "group",
  scopeId: "group@g.us",
  memoryType: "topic",
  value: { topic: "bitcoin" },
  confidence: 0.8,
  importance: 0.6,
  status: "ACTIVE",
  evidenceCount: 2,
  createdAt: 1,
  lastConfirmedAt: 2,
  updatedAt: 2,
};

function providers(upsert: VectorMemoryProvider["upsert"] = async () => {}): { embedding: EmbeddingProvider; vector: VectorMemoryProvider } {
  return {
    embedding: { name: "test-embedding", dimensions: 3, available: true, embed: vi.fn(async () => [0.1, 0.2, 0.3]) },
    vector: {
      name: "test-vector",
      available: true,
      ensureCollection: vi.fn(async () => {}),
      upsert: vi.fn(upsert),
      search: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
      health: vi.fn(async () => true),
    },
  };
}

describe("memory vector worker", () => {
  it("persists and completes an embedding job without blocking the memory write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-vector-worker-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    await store.upsertMemory(memory);
    const { embedding, vector } = providers();
    const worker = new MemoryVectorWorker(store, embedding, vector);

    await worker.enqueue(memory);
    expect(store.memoryVectorJobs("PENDING")).toHaveLength(1);
    const reloaded = new FileStore(dir);
    await reloaded.init();
    expect(reloaded.memoryVectorJobs("PENDING")).toHaveLength(1);
    await worker.runOnce();

    expect(vector.upsert).toHaveBeenCalledWith(memory, [0.1, 0.2, 0.3]);
    expect(store.memoryVectorJobs("COMPLETED")).toHaveLength(1);
  });

  it("keeps failed jobs for a later retry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-vector-retry-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    await store.upsertMemory(memory);
    const upsert = vi.fn<VectorMemoryProvider["upsert"]>().mockRejectedValueOnce(new Error("qdrant unavailable")).mockResolvedValue(undefined);
    const { embedding, vector } = providers(upsert);
    const worker = new MemoryVectorWorker(store, embedding, vector);

    await worker.enqueue(memory);
    await worker.runOnce(100);
    expect(store.memoryVectorJobs("FAILED")[0]).toMatchObject({ attempts: 1, lastError: "qdrant unavailable" });
    const retryAt = store.memoryVectorJobs("FAILED")[0]?.nextAttemptAt;
    expect(retryAt).toBeGreaterThan(100);
    await worker.runOnce(retryAt as number);
    expect(store.memoryVectorJobs("COMPLETED")).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("retrieves vectors within the requested scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-vector-search-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const { embedding, vector } = providers();
    const search = vi.fn<VectorMemoryProvider["search"]>().mockResolvedValue([{ memory, score: 0.88 }]);
    vector.search = search;
    const worker = new MemoryVectorWorker(store, embedding, vector);

    await expect(worker.retrieve("bitcoin discussion", memory.scopeId, 2)).resolves.toEqual([{ memory, score: 0.88 }]);
    expect(search).toHaveBeenCalledWith([0.1, 0.2, 0.3], { scopeId: memory.scopeId }, 2);
  });

  it("deletes the vector after the relational memory is removed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-vector-delete-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    await store.upsertMemory(memory);
    const { embedding, vector } = providers();
    const worker = new MemoryVectorWorker(store, embedding, vector);
    await worker.enqueueDeletion(memory.id);
    await store.deleteMemories(memory.scopeId);
    await worker.runOnce();

    expect(vector.delete).toHaveBeenCalledWith(memory.id);
    expect(store.memoryVectorJobs("COMPLETED")).toHaveLength(1);
  });

  it("can force a completed memory job back into the queue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-vector-rebuild-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    await store.upsertMemory(memory);
    const { embedding, vector } = providers();
    const worker = new MemoryVectorWorker(store, embedding, vector);

    await worker.enqueue(memory);
    await worker.runOnce();
    await worker.enqueue(memory);
    expect(store.memoryVectorJobs("PENDING")).toHaveLength(0);
    await worker.enqueue(memory, true);
    expect(store.memoryVectorJobs("PENDING")).toHaveLength(1);
  });

  it("does not mark an upsert complete after a concurrent deletion supersedes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-vector-race-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    await store.upsertMemory(memory);
    let upsertStarted!: () => void;
    const started = new Promise<void>((resolve) => { upsertStarted = resolve; });
    let releaseUpsert!: () => void;
    const upsertPaused = new Promise<void>((resolve) => { releaseUpsert = resolve; });
    const { embedding, vector } = providers(async () => {
      upsertStarted();
      await upsertPaused;
    });
    const worker = new MemoryVectorWorker(store, embedding, vector);

    await worker.enqueue(memory);
    const run = worker.runOnce();
    await started;
    await store.deleteMemory(memory.id);
    releaseUpsert();
    await run;

    expect(store.memoryVectorJobs("PENDING")[0]).toMatchObject({ memoryId: memory.id, operation: "DELETE" });
  });
});
