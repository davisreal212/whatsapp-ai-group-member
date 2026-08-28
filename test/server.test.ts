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
    const transport = { connected: false, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} };
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
    expect((await status.json()).safety.groupOnlyMode).toBe(true);
  });
});
