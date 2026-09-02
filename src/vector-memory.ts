import type { MemoryRecord } from "./types.js";

export interface MemoryFilters {
  scopeId?: string;
  scopeType?: MemoryRecord["scopeType"];
  memoryType?: string;
  sourceMemberId?: string;
  groupId?: string;
}

export interface VectorMemoryHit {
  memory: MemoryRecord;
  score: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly available: boolean;
  embed(text: string): Promise<number[]>;
}

export interface VectorMemoryProvider {
  readonly name: string;
  readonly available: boolean;
  ensureCollection(): Promise<void>;
  upsert(memory: MemoryRecord, vector: number[]): Promise<void>;
  search(vector: number[], filters?: MemoryFilters, limit?: number): Promise<VectorMemoryHit[]>;
  delete(memoryId: string): Promise<void>;
  health(): Promise<boolean>;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini-embedding";
  readonly available: boolean;

  constructor(private readonly apiKey: string | undefined, private readonly model = "gemini-embedding-001", readonly dimensions = 768) {
    this.available = Boolean(apiKey);
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) throw new Error("Gemini embedding API key is not configured");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:embedContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: `models/${this.model}`, content: { parts: [{ text: text.trim().slice(0, 8_000) }] }, outputDimensionality: this.dimensions }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Gemini embeddings returned HTTP ${response.status}`);
    const body = await response.json() as { embedding?: { values?: unknown } };
    const values = body.embedding?.values;
    if (!Array.isArray(values) || values.length !== this.dimensions || !values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("Gemini embeddings returned an invalid vector");
    }
    return values;
  }
}

export class QdrantVectorMemoryProvider implements VectorMemoryProvider {
  readonly name = "qdrant";
  readonly available: boolean;
  private readonly baseUrl?: string;

  constructor(baseUrl: string | undefined, private readonly apiKey: string | undefined, private readonly collection = "memories", private readonly dimensions = 768) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.available = Boolean(this.baseUrl);
  }

  async ensureCollection(): Promise<void> {
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}`, {
      method: "PUT",
      body: JSON.stringify({ vectors: { size: this.dimensions, distance: "Cosine" } }),
    });
    if (!response.ok && response.status !== 409) throw await qdrantError(response, "Qdrant collection setup");
    if (!response.ok) {
      const existing = await this.request(`/collections/${encodeURIComponent(this.collection)}`, { method: "GET" });
      if (!existing.ok) throw await qdrantError(existing, "Qdrant collection inspection");
      const body = await existing.json() as unknown;
      const size = collectionVectorSize(body);
      if (size !== undefined && size !== this.dimensions) {
        throw new Error(`Qdrant collection ${this.collection} uses ${size}-dimensional vectors; configured embedding dimension is ${this.dimensions}`);
      }
    }
    for (const fieldName of ["scopeId", "scopeType", "memoryType", "sourceMemberId"]) {
      await this.ensurePayloadIndex(fieldName);
    }
  }

  async upsert(memory: MemoryRecord, vector: number[]): Promise<void> {
    validateVector(vector, this.dimensions);
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points: [{ id: pointId(memory.id), vector, payload: memoryPayload(memory) }] }),
    });
    if (!response.ok) throw await qdrantError(response, "Qdrant upsert");
  }

  async search(vector: number[], filters: MemoryFilters = {}, limit = 10): Promise<VectorMemoryHit[]> {
    validateVector(vector, this.dimensions);
    const filter = qdrantFilter(filters);
    let response = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/query`, {
      method: "POST",
      body: JSON.stringify({ query: vector, limit: Math.max(1, Math.min(100, limit)), with_payload: true, ...(filter ? { filter } : {}) }),
    });
    if (response.status === 404) {
      response = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/search`, {
        method: "POST",
        body: JSON.stringify({ vector, limit: Math.max(1, Math.min(100, limit)), with_payload: true, ...(filter ? { filter } : {}) }),
      });
    }
    if (!response.ok) throw await qdrantError(response, "Qdrant search");
    const body = await response.json() as { result?: unknown };
    if (!Array.isArray(body.result)) return [];
    return body.result.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const hit = item as { score?: unknown; payload?: unknown };
      const memory = memoryFromPayload(hit.payload);
      return memory && typeof hit.score === "number" ? [{ memory, score: hit.score }] : [];
    });
  }

  async delete(memoryId: string): Promise<void> {
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/delete?wait=true`, {
      method: "POST",
      body: JSON.stringify({ points: [pointId(memoryId)] }),
    });
    if (!response.ok) throw await qdrantError(response, "Qdrant delete");
  }

  async health(): Promise<boolean> {
    if (!this.available) return false;
    try {
      const response = await this.request(`/collections/${encodeURIComponent(this.collection)}`, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (!this.baseUrl) throw new Error("Qdrant URL is not configured");
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(this.apiKey ? { "api-key": this.apiKey } : {}), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  }

  private async ensurePayloadIndex(fieldName: string): Promise<void> {
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}/index`, {
      method: "PUT",
      body: JSON.stringify({ field_name: fieldName, field_schema: "keyword" }),
    });
    if (!response.ok && response.status !== 409) throw await qdrantError(response, `Qdrant ${fieldName} index setup`);
  }
}

function validateVector(vector: number[], dimensions: number): void {
  if (vector.length !== dimensions || !vector.every((value) => Number.isFinite(value))) throw new Error(`Embedding vector must contain ${dimensions} finite values`);
}

async function qdrantError(response: Response, operation: string): Promise<Error> {
  const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
  return new Error(`${operation} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function collectionVectorSize(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== "object") return undefined;
  const config = (result as { config?: unknown }).config;
  if (!config || typeof config !== "object") return undefined;
  const params = (config as { params?: unknown }).params;
  if (!params || typeof params !== "object") return undefined;
  const vectors = (params as { vectors?: unknown }).vectors;
  if (!vectors || typeof vectors !== "object") return undefined;
  const size = (vectors as { size?: unknown }).size;
  return typeof size === "number" ? size : undefined;
}

function memoryPayload(memory: MemoryRecord): Record<string, unknown> {
  return {
    id: memory.id,
    scopeType: memory.scopeType,
    scopeId: memory.scopeId,
    ...(groupIdForMemory(memory) ? { groupId: groupIdForMemory(memory) } : {}),
    memoryType: memory.memoryType,
    value: memory.value,
    confidence: memory.confidence,
    importance: memory.importance,
    status: memory.status,
    evidenceCount: memory.evidenceCount,
    createdAt: memory.createdAt,
    lastConfirmedAt: memory.lastConfirmedAt,
    updatedAt: memory.updatedAt,
    ...(memory.sourceMessageId ? { sourceMessageId: memory.sourceMessageId } : {}),
    ...(memory.sourceTimestamp !== undefined ? { sourceTimestamp: memory.sourceTimestamp } : {}),
    ...(memory.sourceMemberId ? { sourceMemberId: memory.sourceMemberId } : {}),
    ...(memory.expiresAt !== undefined ? { expiresAt: memory.expiresAt } : {}),
  };
}

function memoryFromPayload(value: unknown): MemoryRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || typeof payload.scopeType !== "string" || !["group", "member", "relationship", "source"].includes(payload.scopeType) || typeof payload.scopeId !== "string" || typeof payload.memoryType !== "string" || !payload.value || typeof payload.value !== "object") return undefined;
  if (typeof payload.confidence !== "number" || typeof payload.importance !== "number" || typeof payload.evidenceCount !== "number" || typeof payload.createdAt !== "number" || typeof payload.lastConfirmedAt !== "number" || typeof payload.updatedAt !== "number") return undefined;
  if (typeof payload.status !== "string" || !["ACTIVE", "WEAK", "STALE", "ARCHIVED", "DELETED"].includes(payload.status)) return undefined;
  return {
    id: payload.id,
    scopeType: payload.scopeType as MemoryRecord["scopeType"],
    scopeId: payload.scopeId,
    memoryType: payload.memoryType,
    value: payload.value as Record<string, unknown>,
    confidence: payload.confidence,
    importance: payload.importance,
    status: payload.status as MemoryRecord["status"],
    evidenceCount: payload.evidenceCount,
    createdAt: payload.createdAt,
    lastConfirmedAt: payload.lastConfirmedAt,
    updatedAt: payload.updatedAt,
    ...(typeof payload.sourceMessageId === "string" ? { sourceMessageId: payload.sourceMessageId } : {}),
    ...(typeof payload.sourceTimestamp === "number" ? { sourceTimestamp: payload.sourceTimestamp } : {}),
    ...(typeof payload.sourceMemberId === "string" ? { sourceMemberId: payload.sourceMemberId } : {}),
    ...(typeof payload.expiresAt === "number" ? { expiresAt: payload.expiresAt } : {}),
  };
}

function qdrantFilter(filters: MemoryFilters): Record<string, unknown> | undefined {
  const must = [
    filters.scopeId ? { key: "scopeId", match: { value: filters.scopeId } } : undefined,
    filters.scopeType ? { key: "scopeType", match: { value: filters.scopeType } } : undefined,
    filters.memoryType ? { key: "memoryType", match: { value: filters.memoryType } } : undefined,
    filters.sourceMemberId ? { key: "sourceMemberId", match: { value: filters.sourceMemberId } } : undefined,
    filters.groupId ? { key: "scopeType", match: { value: "group" } } : undefined,
    filters.groupId ? { key: "scopeId", match: { value: filters.groupId } } : undefined,
  ].filter((item): item is { key: string; match: { value: string } } => item !== undefined);
  return must.length ? { must } : undefined;
}

function groupIdForMemory(memory: MemoryRecord): string | undefined {
  if (memory.scopeType === "group") return memory.scopeId;
  if (memory.scopeType === "member" && memory.scopeId.endsWith("@g.us")) return memory.scopeId;
  const separator = memory.scopeId.indexOf(":");
  const groupId = separator > 0 ? memory.scopeId.slice(0, separator) : undefined;
  return groupId?.endsWith("@g.us") ? groupId : undefined;
}

function pointId(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return id;
  const hex = id.replace(/[^0-9a-f]/gi, "").padEnd(32, "0").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}
