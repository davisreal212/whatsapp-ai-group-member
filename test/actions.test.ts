import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActionService } from "../src/actions.js";
import { loadConfig } from "../src/config.js";
import { FileStore } from "../src/store.js";
import type { CanonicalMessage, GroupRecord } from "../src/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const group: GroupRecord = {
  id: "123@g.us", whatsappGroupId: "123@g.us", subject: "Test", participantCount: 2,
  isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now(),
};
const source: CanonicalMessage = {
  id: "source-1", chatId: group.id, groupId: group.id, senderId: "member@s.whatsapp.net", timestamp: Date.now(), type: "text",
  text: "@Kola reply", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false,
};

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "whatsapp-ai-test-"));
  tempDirs.push(dir);
  const store = new FileStore(dir);
  await store.init();
  await store.upsertGroup(group);
  await store.storeMessage({ ...source, storedAt: Date.now() });
  return { store, config: loadConfig({ NODE_ENV: "test", DATA_DIR: dir, DRY_RUN: "false", GROUP_COOLDOWN_MS: "0", DAILY_ACTION_LIMIT: "5" }) };
}

describe("validated outbound actions", () => {
  it("sends only a validated reply and suppresses an idempotent duplicate", async () => {
    const { store, config } = await setup();
    const sent: string[] = [];
    const transport = {
      connected: true,
      sendText: async (_groupId: string, text: string) => { sent.push(text); },
      sendReaction: async () => {},
      sendMedia: async () => {},
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY_QUOTED" as const, confidence: 0.9, reason: "direct reply", targetMessageId: source.id, text: "I checked.", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("sent");
    expect(sent).toEqual(["I checked."]);
    expect((await service.execute(plan, source, group)).reason).toBe("duplicate_action");
  });

  it("rejects a target message from a different group", async () => {
    const { store, config } = await setup();
    const transport = { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY_QUOTED" as const, confidence: 1, reason: "test", targetMessageId: "not-in-store", text: "No", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("target_not_in_group");
  });

  it("keeps outbound actions disabled in dry-run mode", async () => {
    const { store } = await setup();
    const config = loadConfig({ NODE_ENV: "test", DRY_RUN: "true", DATA_DIR: "/tmp/ignored" });
    let called = false;
    const transport = { connected: true, sendText: async () => { called = true; }, sendReaction: async () => {}, sendMedia: async () => {} };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 1, reason: "test", text: "Safe", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("dry_run");
    expect(called).toBe(false);
  });
});
