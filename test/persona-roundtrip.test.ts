import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot.js";
import { loadConfig } from "../src/config.js";
import { FileStore } from "../src/store.js";
import { createApp } from "../src/server.js";

const TOKEN = "test-token-that-is-long-enough";
const resources: Array<{ dir: string; server: Server }> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ dir, server }) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }));
});

async function boot(dir: string) {
  const config = loadConfig({ NODE_ENV: "production", ADMIN_TOKEN: TOKEN, DATA_DIR: dir, WHATSAPP_AUTH_DIR: join(dir, "auth"), DATABASE_URL: "postgresql://test" });
  const transport = { connected: false, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {}, listDirectMessages: () => [] };
  const runtime = new BotRuntime(new FileStore(dir), config, transport);
  await runtime.init();
  const server = createServer(createApp(runtime, config));
  resources.push({ dir, server });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return { runtime, base: `http://127.0.0.1:${address.port}` };
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

describe("persona mode save-then-load round trip", () => {
  it("personaMode='folk' survives PUT/POST save, page load, and restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "persona-roundtrip-"));
    const first = await boot(dir);
    // exactly what the dashboard form sends
    const payload = {
      displayName: "Kola", genderPresentation: "neutral", tone: "casual", responseLength: "short",
      personalityPresets: [], languages: ["english"], customDescription: "", personaMode: "folk", customPersonaPrompt: "",
      talkativeness: 0.35, humorLevel: 0.45, emojiFrequency: 0.15, initiative: 0.3,
      respondToMentions: true, respondToReplies: true, joinRelevantConversations: true, initiateConversations: false,
      initiationIntervalMs: 360000, maxDailyInitiations: 2, memoryEnabled: true, webSearchEnabled: true, mediaSkillsEnabled: true, voiceSkillsEnabled: true,
    };
    const saved = await fetch(`${first.base}/api/personality`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
    expect(saved.status).toBe(200);
    expect((await saved.json()).personaMode).toBe("folk");
    // page load
    const loaded = await (await fetch(`${first.base}/api/status`, { headers: auth })).json();
    expect(loaded.personality.personaMode).toBe("folk");
    const personaLoad = await (await fetch(`${first.base}/api/personality`, { headers: auth })).json();
    expect(personaLoad.personaMode).toBe("folk");
    // restart: a fresh runtime reading the same data dir
    const second = await boot(dir);
    expect(second.runtime.personalityForGroup().personaMode).toBe("folk");
    const reloaded = await (await fetch(`${second.base}/api/personality`, { headers: auth })).json();
    expect(reloaded.personaMode).toBe("folk");
  });
});

describe("folk prompt size and skill hints", () => {
  it("folk skill hints are one-liners under a byte cap, never full descriptions", async () => {
    const { skillHintsForMode, FOLK_SKILL_HINT_BYTE_CAP } = await import("../src/persona.js");
    const all = Array.from({ length: 300 }, (_, index) => ({
      skillId: `skill_${index}`, name: `Skill ${index}`, description: "x".repeat(500), category: "c", scope: "global", enabled: index % 2 === 0,
    }));
    const hints = skillHintsForMode("folk", [], all);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => hint.description === "")).toBe(true);
    expect(JSON.stringify(hints).length).toBeLessThanOrEqual(FOLK_SKILL_HINT_BYTE_CAP);
  });

  it("folk persona block plus skill hints stays under the 10KB prompt budget", async () => {
    const { personaInstructions, defaultPersonality, resolvePersonality, skillHintsForMode } = await import("../src/persona.js");
    const folk = resolvePersonality(defaultPersonality("Kola"), { personaMode: "folk" });
    const all = Array.from({ length: 300 }, (_, index) => ({ skillId: `skill_${index}`, name: `Skill ${index}`, description: "x".repeat(500), category: "c", scope: "global", enabled: true }));
    const block = personaInstructions(folk).join("\n") + JSON.stringify(skillHintsForMode("folk", [], all));
    expect(Buffer.byteLength(block, "utf8")).toBeLessThan(10_000);
  });
});
