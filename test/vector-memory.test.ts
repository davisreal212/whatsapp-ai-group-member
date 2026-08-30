import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider, QdrantVectorMemoryProvider } from "../src/vector-memory.js";
import type { MemoryRecord } from "../src/types.js";

afterEach(() => vi.unstubAllGlobals());

const memory: MemoryRecord = {
  id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
  sourceMessageId: "message-1",
  sourceTimestamp: 2,
  sourceMemberId: "member-1",
};

describe("vector memory adapters", () => {
  it("stays disabled when Qdrant is not configured", async () => {
    const provider = new QdrantVectorMemoryProvider(undefined, undefined, "memories", 3);
    expect(provider.available).toBe(false);
    expect(await provider.health()).toBe(false);
  });

  it("writes and reads scoped Qdrant payloads", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/points/search")) return new Response(JSON.stringify({ result: [{ score: 0.91, payload: { ...memory } }] }), { status: 200 });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }));
    const provider = new QdrantVectorMemoryProvider("https://qdrant.example", "secret", "memories", 3);
    await provider.ensureCollection();
    await provider.upsert(memory, [0.1, 0.2, 0.3]);
    const result = await provider.search([0.1, 0.2, 0.3], { groupId: memory.scopeId, memoryType: "topic" });
    await provider.delete(memory.id);
    expect(result[0]).toMatchObject({ score: 0.91, memory: { id: memory.id, scopeId: memory.scopeId } });
    expect(requests).toHaveLength(4);
    const searchBody = JSON.parse(String(requests[2]?.init?.body)) as { filter?: { must?: Array<Record<string, unknown>> } };
    expect(searchBody.filter?.must).toEqual(expect.arrayContaining([{ key: "memoryType", match: { value: "topic" } }, { key: "scopeType", match: { value: "group" } }, { key: "scopeId", match: { value: memory.scopeId } }]));
    expect(requests[0]?.init?.headers).toMatchObject({ "api-key": "secret" });
  });

  it("validates Gemini embedding dimensions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), { status: 200 })));
    const provider = new GeminiEmbeddingProvider("secret", "gemini-embedding-001", 3);
    expect(await provider.embed("hello")).toEqual([0.1, 0.2, 0.3]);
  });
});
