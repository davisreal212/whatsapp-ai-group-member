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
    expect(context.member?.behaviorProfile.initiates).toBe(1);
    expect(context.memories[0]?.type).toBe("communication-style");
    const style = store.memories(`${message.chatId}:${message.senderId}`)[0];
    expect(style).toMatchObject({ importance: 0.25, status: "WEAK", sourceMessageId: message.id, sourceTimestamp: message.timestamp, sourceMemberId: message.senderId });
  });

  it("keeps matching messages together and drops unrelated topic history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-thread-context-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const group = { id: "thread@g.us", subject: "Thread group", participantCount: 2, whatsappGroupId: "thread@g.us", isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const save = async (id: string, text: string, timestamp: number, quotedMessageId?: string) => {
      const message: CanonicalMessage = { id, chatId: group.id, groupId: group.id, senderId: id === "current" ? "member-2" : "member-1", timestamp, type: "text", text, mentionedIds: [], ...(quotedMessageId ? { quotedMessageId } : {}), isGroup: true, isStatus: false, isFromBot: false };
      await store.storeMessage({ ...message, storedAt: timestamp });
      return message;
    };
    const now = Date.now();
    await save("bitcoin", "The bitcoin price is moving", now - 3_000);
    await save("weather", "The weather is changing", now - 2_000);
    await save("current", "What is the bitcoin price?", now);
    const memory = new MemoryService(store);
    const continuation = memory.context(group, "member-2", loadConfig({ NODE_ENV: "test" }).personality, "What is the bitcoin price?");
    expect(continuation.thread?.state).toBe("continuation");
    expect(continuation.recentMessages.map((item) => item.text)).toEqual(["The bitcoin price is moving", "What is the bitcoin price?"]);

    await save("new-topic", "What is the football score?", now + 1_000);
    const newTopic = memory.context(group, "member-2", loadConfig({ NODE_ENV: "test" }).personality, "What is the football score?");
    expect(newTopic.thread?.state).toBe("new_topic");
    expect(newTopic.recentMessages.map((item) => item.text)).toEqual(["What is the football score?"]);
  });

  it("follows explicit WhatsApp reply chains over intervening messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-reply-chain-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const group = { id: "reply@g.us", subject: "Reply group", participantCount: 2, whatsappGroupId: "reply@g.us", isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const now = Date.now();
    const root: CanonicalMessage = { id: "root", chatId: group.id, groupId: group.id, senderId: "member-1", timestamp: now - 2_000, type: "text", text: "The launch is Friday", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const unrelated: CanonicalMessage = { id: "unrelated", chatId: group.id, groupId: group.id, senderId: "member-1", timestamp: now - 1_000, type: "text", text: "The match starts soon", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const reply: CanonicalMessage = { id: "reply", chatId: group.id, groupId: group.id, senderId: "member-2", timestamp: now, type: "text", text: "Yes, I will be ready", mentionedIds: [], quotedMessageId: root.id, isGroup: true, isStatus: false, isFromBot: false };
    for (const message of [root, unrelated, reply]) await store.storeMessage({ ...message, storedAt: message.timestamp });
    const context = new MemoryService(store).context(group, reply.senderId, loadConfig({ NODE_ENV: "test" }).personality, reply.text);
    expect(context.thread?.state).toBe("reply_chain");
    expect(context.recentMessages.map((item) => item.text)).toEqual([root.text, reply.text]);
  });

  it("keeps the newest ingested message current when WhatsApp timestamps are identical", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-same-second-thread-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const group = { id: "same-second@g.us", subject: "Same second group", participantCount: 2, whatsappGroupId: "same-second@g.us", isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const timestamp = Date.now();
    const first: CanonicalMessage = { id: "first", chatId: group.id, groupId: group.id, senderId: "member-1", timestamp, type: "text", text: "The first message", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const current: CanonicalMessage = { id: "current-same-second", chatId: group.id, groupId: group.id, senderId: "member-2", timestamp, type: "text", text: "A separate question", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    await store.storeMessage({ ...first, storedAt: timestamp });
    await store.storeMessage({ ...current, storedAt: timestamp + 1 });

    const context = new MemoryService(store).context(group, current.senderId, loadConfig({ NODE_ENV: "test" }).personality, current.text);
    expect(context.thread?.state).toBe("new_topic");
    expect(context.recentMessages.map((item) => item.text)).toEqual([current.text]);
  });

  it("includes a recent bot reply when a member sends an unquoted short follow-up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-bot-follow-up-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const group = { id: "bot-follow-up@g.us", subject: "Bot follow-up group", participantCount: 2, whatsappGroupId: "bot-follow-up@g.us", isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const now = Date.now();
    const source: CanonicalMessage = { id: "source", chatId: group.id, groupId: group.id, senderId: "member-1", timestamp: now - 2_000, type: "text", text: "Tell us a joke", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const current: CanonicalMessage = { id: "follow-up", chatId: group.id, groupId: group.id, senderId: "member-2", timestamp: now, type: "text", text: "lol", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    await store.storeMessage({ ...source, storedAt: now - 2_000 });
    await store.storeMessage({ ...current, storedAt: now });
    await store.createAction({ id: "bot-action", idempotencyKey: "bot-action", groupId: group.id, sourceMessageId: source.id, actionType: "REPLY", payload: { text: "Why did the chicken cross the road?" }, scheduledFor: now - 1_000, status: "SENT", executedAt: now - 1_000 });

    const context = new MemoryService(store).context(group, current.senderId, loadConfig({ NODE_ENV: "test" }).personality, current.text, current.id);
    expect(context.thread?.state).toBe("continuation");
    expect(context.thread?.messages.map((item) => item.role)).toContain("bot");
    expect(context.thread?.messages.map((item) => item.text)).toContain("Why did the chicken cross the road?");
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

  it("does not retrieve archived or deleted memories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-memory-status-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const now = Date.now();
    await store.upsertMemory({ id: "active", scopeType: "group", scopeId: "group@g.us", memoryType: "topic", value: { topic: "bitcoin" }, confidence: 0.9, importance: 0.9, status: "ACTIVE", evidenceCount: 3, createdAt: now, lastConfirmedAt: now, updatedAt: now });
    await store.upsertMemory({ id: "archived", scopeType: "group", scopeId: "group@g.us", memoryType: "topic", value: { topic: "bitcoin" }, confidence: 1, importance: 1, status: "ARCHIVED", evidenceCount: 10, createdAt: now, lastConfirmedAt: now, updatedAt: now });
    const memory = new MemoryService(store);
    const context = memory.context({ id: "group@g.us", subject: "Group", participantCount: 2, whatsappGroupId: "group@g.us", isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: now }, "member", loadConfig({ NODE_ENV: "test" }).personality, "bitcoin");
    expect(context.memories.map((item) => item.type)).toEqual(["topic"]);
  });

  it("adds scoped semantic hits from the relational source of truth", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-semantic-memory-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const now = Date.now();
    const semanticMemory = { id: "semantic-group", scopeType: "group" as const, scopeId: "group@g.us", memoryType: "inside-joke", value: { joke: "old bitcoin joke" }, confidence: 0.8, importance: 0.7, status: "ACTIVE" as const, evidenceCount: 3, createdAt: now - 365 * 86_400_000, lastConfirmedAt: now - 365 * 86_400_000, updatedAt: now - 365 * 86_400_000 };
    await store.upsertMemory(semanticMemory);
    for (let index = 0; index < 20; index += 1) {
      await store.upsertMemory({ id: `recent-${index}`, scopeType: "group", scopeId: "group@g.us", memoryType: "topic", value: { topic: `recent-${index}` }, confidence: 0.5, importance: 0.5, status: "ACTIVE", evidenceCount: 1, createdAt: now, lastConfirmedAt: now, updatedAt: now });
    }
    const requestedScopes: string[] = [];
    const memory = new MemoryService(store, undefined, async (_query, scopeId) => {
      requestedScopes.push(scopeId);
      return scopeId === "group@g.us" ? [{ memory: semanticMemory, score: 0.99 }] : [];
    });
    const context = await memory.contextWithSemantic({ id: "group@g.us", subject: "Group", participantCount: 2, whatsappGroupId: "group@g.us", isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: now }, "member", loadConfig({ NODE_ENV: "test" }).personality, "old joke");

    expect(requestedScopes).toEqual(["group@g.us", "group@g.us:member"]);
    expect(context.memories.some((item) => item.id === semanticMemory.id)).toBe(true);
  });

  it("does not learn new group context when learning is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-learning-toggle-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    await store.upsertGroup({ id: "group@g.us", whatsappGroupId: "group@g.us", subject: "Group", participantCount: 1, isAdmin: false, enabled: true, aiPaused: false, learningEnabled: false, lastSeenAt: Date.now() });
    await new MemoryService(store).observe({ id: "message", chatId: "group@g.us", groupId: "group@g.us", senderId: "member", timestamp: Date.now(), type: "text", text: "bitcoin", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false });

    expect(store.members("group@g.us")).toHaveLength(0);
    expect(store.memories("group@g.us")).toHaveLength(0);
  });

  it("skips low-value and sensitive messages as durable memory candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-memory-candidates-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const memory = new MemoryService(store);
    const message = (id: string, text: string): CanonicalMessage => ({ id, chatId: "candidate@g.us", groupId: "candidate@g.us", senderId: "member", timestamp: Date.now(), type: "text", text, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false });

    await memory.observe(message("noise", "lol 😂"));
    await memory.observe(message("secret", "my password is secret"));

    expect(store.members("candidate@g.us")).toHaveLength(1);
    expect(store.memories("candidate@g.us")).toHaveLength(0);
  });

  it("does not learn capability or completion claims as facts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-memory-capability-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const memory = new MemoryService(store);
    const message: CanonicalMessage = { id: "capability-claim", chatId: "capability@g.us", groupId: "capability@g.us", senderId: "member", timestamp: Date.now(), type: "text", text: "The bot can use a new tool and already completed the action", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    await memory.observe(message);

    expect(store.memories("capability@g.us")).toHaveLength(0);
  });

  it("keeps sensitive text out of conversation summaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-memory-summary-privacy-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const memory = new MemoryService(store);
    for (let index = 0; index < 5; index += 1) {
      const text = index === 2 ? "my password is secret" : `useful topic ${index}`;
      const message: CanonicalMessage = { id: `privacy-summary-${index}`, chatId: "privacy@g.us", groupId: "privacy@g.us", senderId: `member-${index}`, timestamp: Date.now() + index, type: "text", text, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
      await store.storeMessage({ ...message, storedAt: Date.now() });
      await memory.observe(message);
    }

    const summary = store.memories("privacy@g.us").find((item) => item.memoryType === "conversation-summary");
    expect(summary?.value.summary).toContain("useful topic 4");
    expect(summary?.value.summary).not.toContain("password");
    expect(summary?.value.summary).not.toContain("secret");
  });

  it("keeps conversation summaries on five-message boundaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-summary-batches-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const memory = new MemoryService(store);
    for (let index = 0; index < 6; index += 1) {
      const message: CanonicalMessage = { id: `batch-${index}`, chatId: "batch@g.us", groupId: "batch@g.us", senderId: `member-${index}`, timestamp: Date.now() + index, type: "text", text: `bitcoin update ${index}`, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
      await store.storeMessage({ ...message, storedAt: Date.now() });
      await memory.observe(message);
    }
    expect(store.memories("batch@g.us").find((item) => item.memoryType === "conversation-summary")?.value.messageCount).toBe(5);

    for (let index = 6; index < 10; index += 1) {
      const message: CanonicalMessage = { id: `batch-${index}`, chatId: "batch@g.us", groupId: "batch@g.us", senderId: `member-${index}`, timestamp: Date.now() + index, type: "text", text: `bitcoin update ${index}`, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
      await store.storeMessage({ ...message, storedAt: Date.now() });
      await memory.observe(message);
    }
    expect(store.memories("batch@g.us").find((item) => item.memoryType === "conversation-summary")?.value.messageCount).toBe(10);
  });

  it("ages and merges memory records within the same scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-memory-maintenance-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const old = Date.now() - 40 * 86_400_000;
    await store.upsertMemory({ id: "memory-a", scopeType: "group", scopeId: "group@g.us", memoryType: "topic", value: { topic: "btc" }, confidence: 0.6, importance: 0.4, status: "ACTIVE", evidenceCount: 1, createdAt: old, lastConfirmedAt: old, updatedAt: old });
    await store.upsertMemory({ id: "memory-b", scopeType: "group", scopeId: "group@g.us", memoryType: "topic", value: { topic: "btc" }, confidence: 0.9, importance: 0.8, status: "ACTIVE", evidenceCount: 2, createdAt: old, lastConfirmedAt: old, updatedAt: old + 1 });
    const result = await new MemoryService(store, undefined, undefined, { staleAfterDays: 30, archiveAfterDays: 90 }).maintain(Date.now());

    expect(result.merged).toBe(1);
    expect(store.memories("group@g.us")).toHaveLength(1);
    expect(store.memories("group@g.us")[0]).toMatchObject({ evidenceCount: 3, status: "STALE", confidence: 0.9, importance: 0.8 });
  });
});
