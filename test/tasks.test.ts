import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { FileStore } from "../src/store.js";
import { TaskService } from "../src/tasks.js";
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
});
