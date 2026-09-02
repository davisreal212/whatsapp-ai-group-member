import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchService, type MediaSearchProvider, type SearchResult, type WebResearchProvider } from "../src/research.js";
import { FileStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("research fallback", () => {
  it("uses the next search provider after a primary failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-research-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const primary: WebResearchProvider = { name: "primary", available: true, search: async (): Promise<SearchResult[]> => { throw new Error("timeout"); } };
    const backup: WebResearchProvider = { name: "backup", available: true, search: async () => [{ url: "https://example.com/story", title: "Story", content: "Evidence" }] };
    const bundle = await new ResearchService(store, [primary, backup]).research("what happened today", 5);
    expect(bundle.sources[0]?.url).toBe("https://example.com/story");
    expect(store.snapshot.runtime.metrics.webSearches).toBe(1);
    expect(store.logs().some((log) => log.event === "research.failure" && log.details.provider === "primary")).toBe(true);
  });

  it("filters unsafe media results and caches safe candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-media-search-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    let calls = 0;
    const provider: MediaSearchProvider = {
      name: "test-images",
      available: true,
      search: async () => {
        calls += 1;
        return [{ url: "http://unsafe.example/image.jpg" }, { url: "https://cdn.example/image.png", mimeType: "image/png" }];
      },
    };
    const service = new ResearchService(store, [], [provider]);
    await expect(service.searchMedia("president", 5)).resolves.toEqual([{ url: "https://cdn.example/image.png", mimeType: "image/png" }]);
    await service.searchMedia("president", 5);
    expect(calls).toBe(1);
    expect(store.snapshot.runtime.metrics.webSearches).toBe(1);
  });

  it("retrieves and extracts a user-provided page instead of searching the URL text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-link-analysis-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><head><title>Acme Studio</title></head><body><script>ignore me</script><h1>We match freelance designers with startups.</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } })));
    const bundle = await new ResearchService(store, []).research("Analyze this brand https://example.com", 5);
    expect(bundle.verdict).toBe("verified");
    expect(bundle.sources[0]).toMatchObject({ title: "Acme Studio", url: "https://example.com" });
    expect(bundle.sources[0]?.evidence).toContain("We match freelance designers with startups.");
  });
});
