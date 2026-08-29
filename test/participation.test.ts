import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActionService } from "../src/actions.js";
import { loadConfig } from "../src/config.js";
import { groupActivityState } from "../src/participation.js";
import { FileStore } from "../src/store.js";
import type { CanonicalMessage, GroupRecord } from "../src/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const group = (id: string): GroupRecord => ({
  id, whatsappGroupId: id, subject: id, participantCount: 2, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now(),
});

const message = (id: string, groupId: string, text = "A useful question for Kola") : CanonicalMessage => ({
  id, chatId: groupId, groupId, senderId: `member-${id}`, timestamp: Date.now(), type: "text", text, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false,
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-participation-"));
  tempDirs.push(dir);
  const store = new FileStore(dir);
  await store.init();
  const config = loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false", GROUP_COOLDOWN_MS: "15000", DAILY_ACTION_LIMIT: "50" });
  return { store, config };
}

const plan = (text: string, extra: Record<string, unknown> = {}) => ({
  decision: "REPLY" as const, confidence: 1, reason: "test", text, delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const, ...extra,
});

describe("Chapter 31 participation controls", () => {
  it("uses a per-group cooldown while allowing a direct bypass", async () => {
    const { store, config } = await setup();
    const first = group("one@g.us");
    const second = group("two@g.us");
    await store.upsertGroup(first);
    await store.upsertGroup(second);
    const firstMessage = message("first", first.id);
    const secondMessage = message("second", first.id);
    const otherGroupMessage = message("other", second.id);
    await Promise.all([firstMessage, secondMessage, otherGroupMessage].map((item) => store.storeMessage({ ...item, storedAt: Date.now() })));
    const sent: string[] = [];
    const service = new ActionService(store, config, { connected: true, sendText: async (_chatId, text) => { sent.push(text); }, sendReaction: async () => {}, sendMedia: async () => {} });
    expect((await service.execute(plan("first"), firstMessage, first)).reason).toBe("sent");
    expect((await service.execute(plan("blocked"), secondMessage, first)).reason).toBe("group_cooldown");
    expect((await service.execute(plan("other group"), otherGroupMessage, second)).reason).toBe("sent");
    const direct = message("direct", first.id, "Kola, answer now");
    direct.quotedSenderId = "bot@s.whatsapp.net";
    await store.storeMessage({ ...direct, storedAt: Date.now() });
    expect((await service.execute(plan("direct", { priority: "HIGH", bypassCooldown: true }), direct, first)).reason).toBe("sent");
    expect(sent).toEqual(["first", "other group", "direct"]);
  });

  it("protects mention-all and detects high-volume activity", async () => {
    const { store, config } = await setup();
    const target = group("busy@g.us");
    await store.upsertGroup(target);
    const now = Date.now();
    for (let index = 0; index < 20; index += 1) {
      const item = { ...message(`burst-${index}`, target.id), timestamp: now - index * 100 };
      await store.storeMessage({ ...item, storedAt: now });
    }
    expect(groupActivityState(store, target.id, config.participation, now).activityLevel).toBe("EXTREME");
    const first = message("mention-first", target.id, "@all please read this");
    const second = message("mention-second", target.id, "@all another update");
    await store.storeMessage({ ...first, storedAt: now });
    await store.storeMessage({ ...second, storedAt: now });
    const service = new ActionService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} });
    expect((await service.execute(plan("first mention", { mentionAll: true, priority: "CRITICAL", bypassCooldown: true }), first, target)).reason).toBe("sent");
    expect((await service.execute(plan("second mention", { mentionAll: true, priority: "HIGH", bypassCooldown: true }), second, target)).reason).toBe("mention_all_cooldown");
  });

  it("reserves the group slot before concurrent sends can both pass", async () => {
    const { store, config } = await setup();
    const target = group("race@g.us");
    await store.upsertGroup(target);
    const first = message("race-first", target.id);
    const second = message("race-second", target.id);
    await store.storeMessage({ ...first, storedAt: Date.now() });
    await store.storeMessage({ ...second, storedAt: Date.now() });
    const service = new ActionService(store, config, { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} });
    const results = await Promise.all([service.execute(plan("one"), first, target), service.execute(plan("two"), second, target)]);
    expect(results.map((result) => result.reason).sort()).toEqual(["group_cooldown", "sent"]);
  });
});
