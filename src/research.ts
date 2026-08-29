import { createHash } from "node:crypto";
import type { AppConfig, EvidenceBundle, EvidenceSource } from "./types.js";
import type { Store } from "./store.js";
import { isSafeHttpsUrl } from "./network.js";

export interface SearchResult {
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

export interface MediaSearchResult {
  url: string;
  title?: string;
  mimeType?: string;
}

export interface MediaSearchProvider {
  readonly name: string;
  readonly available: boolean;
  search(query: string, maxResults: number): Promise<MediaSearchResult[]>;
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

export class DuckDuckGoProvider implements WebResearchProvider {
  readonly name = "duckduckgo";
  readonly available = true;

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(30_000), headers: { accept: "text/html" } });
    if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
    const html = await response.text();
    const results: SearchResult[] = [];
    for (const link of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (results.length >= maxResults) break;
      results.push({ url: decodeSearchUrl(link[1] ?? ""), title: stripHtml(link[2] ?? "") });
    }
    return results.filter((result) => Boolean(result.url));
  }
}

export class DuckDuckGoImageProvider implements MediaSearchProvider {
  readonly name = "duckduckgo-images";
  readonly available = true;

  async search(query: string, maxResults: number): Promise<MediaSearchResult[]> {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const page = await fetch(searchUrl, {
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
    });
    if (!page.ok) throw new Error(`DuckDuckGo image page returned HTTP ${page.status}`);
    const html = await page.text();
    const vqd = html.match(/vqd=['"]?([\d-]+)/i)?.[1] ?? html.match(/"vqd"\s*:\s*"([\d-]+)"/i)?.[1];
    if (!vqd) throw new Error("DuckDuckGo image token was not found");

    const response = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        referer: searchUrl,
        "user-agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) throw new Error(`DuckDuckGo image search returned HTTP ${response.status}`);
    const body = await response.json() as { results?: Array<{ image?: unknown; title?: unknown; thumbnail?: unknown }> };
    return (body.results ?? [])
      .map((result) => ({
        url: typeof result.image === "string" ? result.image : "",
        ...(typeof result.title === "string" ? { title: stripHtml(result.title) } : {}),
      }))
      .filter((result): result is MediaSearchResult => isSafeHttpsUrl(result.url))
      .slice(0, maxResults);
  }
}

export class WikimediaImageProvider implements MediaSearchProvider {
  readonly name = "wikimedia-images";
  readonly available = true;

  async search(query: string, maxResults: number): Promise<MediaSearchResult[]> {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: String(Math.min(10, Math.max(1, maxResults))),
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "1600",
      format: "json",
      origin: "*",
    });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Wikimedia image search returned HTTP ${response.status}`);
    const body = await response.json() as { query?: { pages?: Record<string, { title?: unknown; imageinfo?: Array<{ thumburl?: unknown; url?: unknown; mime?: unknown }> }> } };
    return Object.values(body.query?.pages ?? [])
      .map((page) => {
        const info = page.imageinfo?.[0];
        const url = typeof info?.thumburl === "string" ? info.thumburl : typeof info?.url === "string" ? info.url : "";
        return {
          url,
          ...(typeof page.title === "string" ? { title: page.title.replace(/^File:/i, "") } : {}),
          ...(typeof info?.mime === "string" ? { mimeType: info.mime.toLowerCase() } : {}),
        };
      })
      .filter((result): result is MediaSearchResult => isSafeHttpsUrl(result.url) && Boolean(result.mimeType?.startsWith("image/") ?? true))
      .slice(0, maxResults);
  }
}

export class ResearchService {
  private readonly cache = new Map<string, { bundle: EvidenceBundle; expiresAt: number }>();
  private readonly mediaCache = new Map<string, { results: MediaSearchResult[]; expiresAt: number }>();
  private readonly providers: WebResearchProvider[];
  private readonly mediaProviders: MediaSearchProvider[];

  constructor(private readonly store: Store, provider: WebResearchProvider | WebResearchProvider[], mediaProviders: MediaSearchProvider[] = [new DuckDuckGoImageProvider(), new WikimediaImageProvider()]) {
    this.providers = Array.isArray(provider) ? provider : [provider];
    this.mediaProviders = mediaProviders;
  }

  async searchMedia(query: string, maxResults: number): Promise<MediaSearchResult[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ").slice(0, 300);
    if (!normalizedQuery) return [];
    const cacheKey = createHash("sha256").update(normalizedQuery.toLowerCase()).digest("hex");
    const cached = this.mediaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;

    const failures: string[] = [];
    for (const provider of this.mediaProviders.filter((item) => item.available)) {
      try {
        const results = (await provider.search(normalizedQuery, maxResults))
          .filter((result) => isSafeHttpsUrl(result.url))
          .slice(0, maxResults);
        await this.store.incrementMetric("webSearches");
        if (!results.length) continue;
        this.mediaCache.set(cacheKey, { results, expiresAt: Date.now() + 10 * 60_000 });
        return results;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        failures.push(`${provider.name}: ${message}`);
        await this.store.addLog({ id: crypto.randomUUID(), event: "media_search.failure", level: "warn", details: { provider: provider.name, error: message }, createdAt: Date.now() });
      }
    }
    if (failures.length) await this.store.addLog({ id: crypto.randomUUID(), event: "media_search.unavailable", level: "warn", details: { providers: failures.map((failure) => failure.split(":", 1)[0]) }, createdAt: Date.now() });
    return [];
  }

  async research(question: string, maxResults: number): Promise<EvidenceBundle> {
    const available = this.providers.filter((provider) => provider.available);
    if (!available.length) return unverified(question);
    const cacheKey = createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.bundle;
    const failures: string[] = [];
    for (const provider of available) {
      try {
      const results = await provider.search(question, maxResults);
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
        const message = error instanceof Error ? error.message : "unknown error";
        failures.push(`${provider.name}: ${message}`);
        await this.store.addLog({ id: crypto.randomUUID(), event: "research.failure", level: "warn", details: { provider: provider.name, error: message }, createdAt: Date.now() });
      }
    }
    if (failures.length) await this.store.addLog({ id: crypto.randomUUID(), event: "research.unverified", level: "warn", details: { providers: failures.map((failure) => failure.split(":", 1)[0]) }, createdAt: Date.now() });
    return unverified(question);
  }
}

function decodeSearchUrl(value: string): string {
  try {
    const url = new URL(value, "https://html.duckduckgo.com");
    const encoded = url.searchParams.get("uddg");
    return encoded ?? url.href;
  } catch {
    return "";
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
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
