import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchService, type MediaSearchProvider, type SearchResult, type WebResearchProvider } from "../src/research.js";
import { FileStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(async () => {
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
});
