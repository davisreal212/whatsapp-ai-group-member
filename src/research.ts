import { createHash } from "node:crypto";
import type { AppConfig, EvidenceBundle, EvidenceSource } from "./types.js";
import type { Store } from "./store.js";

interface SearchResult {
  url?: string;
  title?: string;
  content?: string;
  published_date?: string;
}

export interface WebResearchProvider {
  readonly name: string;
  readonly available: boolean;
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

export class TavilyProvider implements WebResearchProvider {
  readonly name = "tavily";
  readonly available: boolean;

  constructor(private readonly apiKey?: string) {
    this.available = Boolean(apiKey);
  }

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error("Tavily API key is not configured");
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, search_depth: "basic", max_results: maxResults, include_answer: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Tavily returned HTTP ${response.status}`);
    const body = await response.json() as { results?: SearchResult[] };
    return body.results ?? [];
  }
}

export class ResearchService {
  private readonly cache = new Map<string, { bundle: EvidenceBundle; expiresAt: number }>();

  constructor(private readonly store: Store, private readonly provider: WebResearchProvider) {}

  async research(question: string, maxResults: number): Promise<EvidenceBundle> {
    if (!this.provider.available) return unverified(question);
    const cacheKey = createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.bundle;
    try {
      const results = await this.provider.search(question, maxResults);
      await this.store.incrementMetric("webSearches");
      const sources = results
        .filter((result): result is SearchResult & { url: string } => Boolean(result.url))
        .map((result): EvidenceSource => ({
          url: result.url,
          ...(result.title ? { title: result.title } : {}),
          ...(result.published_date ? { publishedAt: result.published_date } : {}),
          sourceType: classifySource(result.url),
          retrievedAt: Date.now(),
          ...(result.content ? { evidence: result.content.slice(0, 1000) } : {}),
        }));
      for (const source of sources) {
        await this.store.upsertMemory({
          id: createHash("sha256").update(`${question}:${source.url}`).digest("hex"),
          scopeType: "source",
          scopeId: question,
          memoryType: "research-source",
          value: { url: source.url, title: source.title ?? "", evidence: source.evidence ?? "" },
          confidence: source.sourceType === "official" ? 0.8 : 0.5,
          evidenceCount: 1,
          createdAt: source.retrievedAt,
          lastConfirmedAt: source.retrievedAt,
          expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        });
      }
      const bundle: EvidenceBundle = {
        question,
        claims: sources.length
          ? [{ claim: "Search results provide potentially relevant evidence.", support: sources.map((source) => source.url), confidence: sources.length > 1 ? 0.65 : 0.45 }]
          : [],
        contradictions: [],
        sources,
        freshness: sources.length ? "recent" : "unknown",
        verdict: sources.length > 1 ? "mixed" : "unverified",
      };
      const ttl = /\b(now|today|breaking|latest|current|price)\b/i.test(question) ? 60_000 : 6 * 60 * 60 * 1000;
      this.cache.set(cacheKey, { bundle, expiresAt: Date.now() + ttl });
      return bundle;
    } catch (error) {
      await this.store.addLog({
        id: crypto.randomUUID(),
        event: "research.failure",
        level: "warn",
        details: { error: error instanceof Error ? error.message : "unknown error" },
        createdAt: Date.now(),
      });
      return unverified(question);
    }
  }
}

function classifySource(url: string): EvidenceSource["sourceType"] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith(".gov") || hostname.endsWith(".gov.ng") || hostname.includes("official")) return "official";
    if (hostname.includes("reuters") || hostname.includes("apnews") || hostname.includes("bbc")) return "news";
    if (hostname.endsWith(".edu") || hostname.includes("wikipedia") || hostname.includes("docs.")) return "reference";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function unverified(question: string): EvidenceBundle {
  return { question, claims: [], contradictions: [], sources: [], freshness: "unknown", verdict: "unverified" };
}
