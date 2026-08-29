import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore } from "../src/store.js";
import type { CanonicalMessage } from "../src/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("store retention", () => {
  it("removes expired data while preserving recent and pending records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-retention-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const now = Date.now();
    await store.storeMessage({ id: "old-message", chatId: "chat", senderId: "sender", timestamp: now - 3 * 86_400_000, type: "text", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false, storedAt: now - 3 * 86_400_000 });
    await store.storeMessage({ id: "new-message", chatId: "chat", senderId: "sender", timestamp: now, type: "text", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false, storedAt: now });
    await store.createAction({ id: "old-action", idempotencyKey: "old", groupId: "chat", sourceMessageId: "old-message", actionType: "REPLY", payload: {}, scheduledFor: now - 3 * 86_400_000, status: "SENT", executedAt: now - 3 * 86_400_000 });
    await store.createAction({ id: "pending-action", idempotencyKey: "pending", groupId: "chat", sourceMessageId: "new-message", actionType: "REPLY", payload: {}, scheduledFor: now - 3 * 86_400_000, status: "PENDING" });
    const result = await store.pruneExpired(2, now);
    expect(result.messages).toBe(1);
    expect(result.actions).toBe(1);
    expect(store.message("old-message")).toBeUndefined();
    expect(store.message("new-message")).toBeDefined();
    expect(store.actions().map((action) => action.id)).toEqual(["pending-action"]);
  });

  it("deduplicates inbound jobs by message id and preserves pending work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-inbound-"));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    await store.init();
    const message: CanonicalMessage = { id: "inbound-message", chatId: "chat", senderId: "sender", timestamp: Date.now(), type: "text", text: "hello", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false };
    const job = { id: "inbound-job", messageId: message.id, chatId: message.chatId, message, status: "PENDING" as const, attempts: 0, createdAt: Date.now(), updatedAt: Date.now() };
    expect(await store.createInboundJob(job)).toBe(true);
    expect(await store.createInboundJob({ ...job, id: "duplicate-job" })).toBe(false);
    expect(store.inboundJobByMessageId(message.id)?.id).toBe(job.id);
    await store.updateInboundJob(job.id, { status: "PROCESSING", attempts: 1 });
    expect(store.inboundJobs("PROCESSING")[0]?.attempts).toBe(1);
  });
});
