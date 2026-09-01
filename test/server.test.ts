import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";

const resources: Array<{ dir: string; server: Server }> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ dir, server }) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }));
});

describe("admin HTTP surface", () => {
  it("serves health publicly and protects mutating APIs in production", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-server-test-"));
    const config = loadConfig({ NODE_ENV: "production", ADMIN_TOKEN: "test-token-that-is-long-enough", DATA_DIR: dir, WHATSAPP_AUTH_DIR: join(dir, "auth"), DATABASE_URL: "postgresql://test" });
    const transport = { connected: false, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {}, listDirectMessages: () => [{ id: "234@s.whatsapp.net", displayName: "Test contact" }] };
    const runtime = new BotRuntime(new (await import("../src/store.js")).FileStore(dir), config, transport);
    await runtime.init();
    const server = createServer(createApp(runtime, config));
    resources.push({ dir, server });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    const protectedResponse = await fetch(`${base}/api/status`);
    expect(protectedResponse.status).toBe(401);
    const status = await fetch(`${base}/api/status`, { headers: { authorization: "Bearer test-token-that-is-long-enough" } });
    expect(status.status).toBe(200);
    expect((await status.json()).safety.groupOnlyMode).toBe(false);

    const persona = await fetch(`${base}/api/personality`, { headers: { authorization: "Bearer test-token-that-is-long-enough" } });
    expect(persona.status).toBe(200);
    expect((await persona.json()).displayName).toBe("Kola");
    const savedPersona = await fetch(`${base}/api/personality`, {
      method: "POST",
      headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Sarah", humorLevel: 80, personalityPresets: ["Funny"] }),
    });
    expect(await savedPersona.json()).toMatchObject({ displayName: "Sarah", humorLevel: 0.8, personalityPresets: ["Funny"] });

    const allowlist = await fetch(`${base}/api/dm-allowlist`, {
      method: "POST",
      headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" },
      body: JSON.stringify({ contacts: ["+234 800 000 0000"] }),
    });
    expect(allowlist.status).toBe(200);
    expect((await allowlist.json()).contacts).toEqual(["+234 800 000 0000"]);
    expect(runtime.dashboardState().safety).toMatchObject({ directMessageAllowlist: ["+234 800 000 0000"] });

    const dms = await fetch(`${base}/api/dms/sync`, { method: "POST", headers: { authorization: "Bearer test-token-that-is-long-enough" } });
    expect(dms.status).toBe(200);
    expect((await dms.json()).contacts).toEqual([{ id: "234@s.whatsapp.net", displayName: "Test contact" }]);

    await runtime.syncGroups([{ id: "old@g.us", subject: "Old group", participantCount: 1, isAdmin: true }]);
    expect(runtime.store.groups()).toHaveLength(1);
    const firstGroupPersona = await fetch(`${base}/api/groups/old@g.us/personality`, {
      method: "POST",
      headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" },
      body: JSON.stringify({ tone: "formal" }),
    });
    expect((await firstGroupPersona.json()).personalityOverride).toMatchObject({ tone: "formal" });
    const secondGroupPersona = await fetch(`${base}/api/groups/old@g.us/personality`, {
      method: "POST",
      headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" },
      body: JSON.stringify({ humorLevel: 90 }),
    });
    expect((await secondGroupPersona.json()).personalityOverride).toMatchObject({ tone: "formal", humorLevel: 0.9 });
    const preview = await fetch(`${base}/api/personality/preview`, {
      method: "POST",
      headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" },
      body: JSON.stringify({ message: "What are you doing?", groupId: "old@g.us" }),
    });
    expect((await preview.json()).response).toContain("I");
    const skills = await fetch(`${base}/api/skills`, { headers: { authorization: "Bearer test-token-that-is-long-enough" } });
    expect((await skills.json()).length).toBeGreaterThan(20);
    await runtime.store.upsertMemory({ id: "memory", scopeType: "group", scopeId: "old@g.us", memoryType: "topic", value: { topic: "bitcoin" }, confidence: 0.8, importance: 0.5, status: "ACTIVE", evidenceCount: 1, createdAt: Date.now(), lastConfirmedAt: Date.now(), updatedAt: Date.now() });
    const memoryStatus = await fetch(`${base}/api/status`, { headers: { authorization: "Bearer test-token-that-is-long-enough" } });
    expect((await memoryStatus.json()).memory).toMatchObject({ storedMemories: 1, activeMemories: 1, groups: 1 });
    const rebuild = await fetch(`${base}/api/memory/rebuild`, { method: "POST", headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" }, body: "{}" });
    expect(await rebuild.json()).toMatchObject({ requested: 1, enabled: false });
    const exported = await fetch(`${base}/api/memory/export`, { headers: { authorization: "Bearer test-token-that-is-long-enough" } });
    expect((await exported.json()).memories).toHaveLength(1);
    const learning = await fetch(`${base}/api/groups/old@g.us/learning`, { method: "POST", headers: { authorization: "Bearer test-token-that-is-long-enough", "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect((await learning.json()).learningEnabled).toBe(false);
    await runtime.syncGroups([]);
    expect(runtime.store.groups()).toHaveLength(0);
  });
});
