import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { FileStore } from "../src/store.js";
import { CoinMarketCapPriceProvider, TaskService } from "../src/tasks.js";
import type { CanonicalMessage } from "../src/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const directMessage = (text: string): CanonicalMessage => ({
  id: `message-${Date.now()}-${Math.random()}`,
  chatId: "234@s.whatsapp.net",
  senderId: "234@s.whatsapp.net",
  timestamp: Date.now(),
  type: "text",
  text,
  mentionedIds: [],
  isGroup: false,
  isStatus: false,
  isFromBot: false,
});

describe("task service", () => {
  it("creates, lists, and cancels owned price alerts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-task-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false", OUTBOUND_PAUSED: "false" });
    const service = new TaskService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} });
    const message = directMessage("once BTC hit 80k abeg let me know");
    const created = await service.handleMessage(message);
    expect(created.handled).toBe(true);
    expect(created.reply).toContain("BITCOIN");
    expect(store.tasks("ACTIVE")[0]?.condition).toEqual({ asset: "bitcoin", operator: "gte", threshold: 80000, currency: "USD" });
    const listed = await service.handleMessage(directMessage("what alerts do I have?"));
    expect(listed.reply).toContain("BITCOIN");
    const cancelled = await service.handleMessage(directMessage("cancel my alert"));
    expect(cancelled.reply).toContain("cancelled");
    expect(store.tasks("ACTIVE")).toHaveLength(0);
  });

  it("asks for a time instead of creating an ambiguous reminder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-reminder-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false" });
    const service = new TaskService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} });
    const result = await service.handleMessage(directMessage("remind me tomorrow to call David"));
    expect(result.reply).toContain("day and time");
    expect(store.tasks()).toHaveLength(0);
  });

  it("creates recurring daily reminders from natural phrasing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-recurring-reminder-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false" });
    const service = new TaskService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} });
    const result = await service.handleMessage(directMessage("remind me every day at 8pm to stretch"));
    expect(result.reply).toContain("remind you");
    expect(store.tasks("ACTIVE")[0]?.recurrence).toBe("DAILY");
  });

  it("triggers a due one-time reminder only once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-due-task-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false", OUTBOUND_PAUSED: "false" });
    const sent: string[] = [];
    const service = new TaskService(store, config, { connected: true, sendText: async (_chatId, text) => { sent.push(text); }, sendReaction: async () => {}, sendMedia: async () => {} });
    await store.createTask({ id: "due-reminder", groupId: "234@s.whatsapp.net", creatorId: "234@s.whatsapp.net", creatorChatId: "234@s.whatsapp.net", type: "REMINDER", message: "call David", status: "ACTIVE", triggerAt: Date.now() - 1, recurrence: "ONCE", notificationTarget: "USER", notificationChatId: "234@s.whatsapp.net", createdAt: Date.now(), retryCount: 0 });
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    service.stop();
    expect(sent).toEqual(["Reminder: call David"]);
    expect(store.task("due-reminder")?.status).toBe("TRIGGERED");
  });

  it("reads BTC and ETH quotes from CoinMarketCap", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { BTC: { quote: { USD: { price: 80000 } } }, ETH: { quote: { USD: { price: 3000 } } } } }), { status: 200 })) as typeof fetch;
    try {
      const provider = new CoinMarketCapPriceProvider("test-key");
      await expect(provider.getPrices(["bitcoin", "ethereum"])).resolves.toEqual({ bitcoin: 80000, ethereum: 3000 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("answers a direct current-price request with a Nigeria timestamp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-price-request-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false" });
    const service = new TaskService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} }, { name: "test-price", getPrices: async () => ({ bitcoin: 80000 }) });
    await expect(service.currentPriceReply("BTC price")).resolves.toMatch(/BTC: \$80,000[\s\S]*Updated [\s\S]* WAT\./);
  });

  it("answers time questions in Nigeria time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-time-request-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false" });
    const service = new TaskService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} });
    expect(service.currentNigeriaDateTimeReply("what time is it today")).toMatch(/^Nigeria time: .* WAT\.$/);
  });
});
