import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryService } from "../src/memory.js";
import { FileStore } from "../src/store.js";
import type { CanonicalMessage } from "../src/types.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("conversation memory", () => {
  it("retains history and member behavior for allowlisted DMs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-memory-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const message: CanonicalMessage = { id: "dm-1", chatId: "234@s.whatsapp.net", senderId: "234@s.whatsapp.net", senderName: "Ada", timestamp: Date.now(), type: "text", text: "abeg check this", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false };
    await store.storeMessage({ ...message, storedAt: Date.now() });
    const memory = new MemoryService(store);
    await memory.observe(message);
    const context = memory.context({ id: message.chatId, subject: "Direct message", participantCount: 1, whatsappGroupId: message.chatId, isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: Date.now() }, message.senderId, loadConfig({ NODE_ENV: "test" }).personality);
    expect(context.recentMessages[0]?.text).toBe(message.text);
    expect(context.member?.behaviorProfile.messageCount).toBe(1);
    expect(context.memories[0]?.type).toBe("communication-style");
  });

  it("learns repeated group topics with scoped confidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-topic-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const memory = new MemoryService(store);
    const groupMessage = (id: string): CanonicalMessage => ({ id, chatId: "group@g.us", groupId: "group@g.us", senderId: "member", timestamp: Date.now(), type: "text", text: "Bitcoin price is moving", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false });
    await memory.observe(groupMessage("group-1"));
    await memory.observe(groupMessage("group-2"));
    const topic = store.memories("group@g.us").find((item) => item.memoryType === "group-topic");
    expect(topic?.value.topic).toBe("bitcoin");
    expect(topic?.evidenceCount).toBe(2);
    expect(topic?.confidence).toBeGreaterThan(0.25);
  });

  it("creates a scoped conversation summary after enough stored messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-summary-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const memory = new MemoryService(store);
    for (let index = 0; index < 5; index += 1) {
      const message: CanonicalMessage = { id: `summary-${index}`, chatId: "group@g.us", groupId: "group@g.us", senderId: `member-${index}`, timestamp: Date.now() + index, type: "text", text: `topic ${index}`, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
      await store.storeMessage({ ...message, storedAt: Date.now() });
      await memory.observe(message);
    }
    const summary = store.memories("group@g.us").find((item) => item.memoryType === "conversation-summary");
    expect(summary?.value.summary).toContain("topic 4");
    expect(summary?.expiresAt).toBeGreaterThan(Date.now());
  });
});
