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
    const sent: Array<{ text: string; quoted?: string }> = [];
    const transport = {
      connected: true,
      sendText: async (_groupId: string, text: string, quoted?: string) => { sent.push({ text, ...(quoted ? { quoted } : {}) }); },
      sendReaction: async () => {},
      sendMedia: async () => {},
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 0.9, reason: "direct reply", text: "I checked.", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("sent");
    expect(sent).toEqual([{ text: "I checked.", quoted: source.id }]);
    expect((await service.execute(plan, source, group)).reason).toBe("duplicate_action");
  });

  it("replays a pending action after the runtime starts", async () => {
    const { store, config } = await setup();
    const sent: string[] = [];
    const transport = {
      connected: true,
      sendText: async (_groupId: string, text: string) => { sent.push(text); },
      sendReaction: async () => {},
      sendMedia: async () => {},
    };
    await store.createAction({ id: "pending-1", idempotencyKey: "pending-key", groupId: group.id, sourceMessageId: source.id, actionType: "REPLY_QUOTED", targetMessageId: source.id, payload: { text: "Recovered." }, scheduledFor: Date.now(), status: "PENDING" });
    const service = new ActionService(store, config, transport);
    service.start();
    await service.stop();
    expect(sent).toEqual(["Recovered."]);
    expect(store.action("pending-1")?.status).toBe("SENT");
  });

  it("moves a repeatedly failing action to the dead-letter state", async () => {
    const { store, config } = await setup();
    config.actionMaxAttempts = 1;
    const transport = {
      connected: true,
      sendText: async () => { throw new Error("temporary failure"); },
      sendReaction: async () => {},
      sendMedia: async () => {},
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 1, reason: "test", text: "Will fail", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("temporary failure");
    expect(store.actions()[0]?.status).toBe("FAILED");
    expect(store.actions()[0]?.attempts).toBe(1);
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

  it("sends only to an allowlisted DM when group-only mode is disabled", async () => {
    const { store } = await setup();
    const dm: CanonicalMessage = {
      id: "dm-source", chatId: "234@s.whatsapp.net", senderId: "234@s.whatsapp.net", timestamp: Date.now(), type: "text",
      text: "Are you there?", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false,
    };
    await store.storeMessage({ ...dm, storedAt: Date.now() });
    const config = loadConfig({ NODE_ENV: "test", DATA_DIR: "/tmp/ignored", DRY_RUN: "false", GROUP_ONLY_MODE: "false", DIRECT_MESSAGE_ALLOWLIST: "+234", GROUP_COOLDOWN_MS: "0" });
    const sent: string[] = [];
    const transport = { connected: true, sendText: async (chatId: string, text: string) => { sent.push(`${chatId}:${text}`); }, sendReaction: async () => {}, sendMedia: async () => {} };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 1, reason: "test", text: "Yes.", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, dm, undefined)).reason).toBe("sent");
    expect(sent).toEqual(["234@s.whatsapp.net:Yes."]);
  });

  it("re-checks the outbound pause after a delayed action waits", async () => {
    const { store, config } = await setup();
    const sent: string[] = [];
    const transport = { connected: true, sendText: async (_chatId: string, text: string) => { sent.push(text); }, sendReaction: async () => {}, sendMedia: async () => {} };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 1, reason: "test", text: "Should not send", delayMs: 10, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    setTimeout(() => { config.outboundPaused = true; }, 1);
    expect((await service.execute(plan, source, group)).reason).toBe("outbound_paused");
    expect(sent).toEqual([]);
  });

  it("holds sends during configured quiet hours", async () => {
    const { store, config } = await setup();
    const hour = new Date().getHours();
    config.quietHoursStart = hour;
    config.quietHoursEnd = (hour + 1) % 24;
    const transport = { connected: true, sendText: async () => { throw new Error("must not send"); }, sendReaction: async () => {}, sendMedia: async () => {} };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 1, reason: "test", text: "Quiet", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("quiet_hours");
  });

  it("sends generated audio through the validated action queue", async () => {
    const { store, config } = await setup();
    const sent: Array<{ chatId: string; bytes: number; quoted?: string }> = [];
    const transport = {
      connected: true,
      sendText: async () => {},
      sendReaction: async () => {},
      sendMedia: async () => { throw new Error("URL media should not be used"); },
      sendAudioBuffer: async (chatId: string, data: Buffer, _mimeType: string, _caption?: string, quoted?: string) => { sent.push({ chatId, bytes: data.length, ...(quoted ? { quoted } : {}) }); },
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "SEND_AUDIO" as const, confidence: 1, reason: "voice reply", targetMessageId: source.id, delayMs: 0, needsWeb: false, needsMedia: true, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group, { data: Buffer.from("audio"), mimeType: "audio/ogg" })).reason).toBe("sent");
    expect(sent).toEqual([{ chatId: group.id, bytes: 5, quoted: source.id }]);
  });

  it("uses the transport's group-wide mention path when requested", async () => {
    const { store, config } = await setup();
    let mentionedAll = false;
    const transport = {
      connected: true,
      sendText: async () => {},
      sendTextToAll: async () => { mentionedAll = true; },
      sendReaction: async () => {},
      sendMedia: async () => {},
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "REPLY" as const, confidence: 1, reason: "announce", text: "Heads up everyone.", mentionAll: true, delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("sent");
    expect(mentionedAll).toBe(true);
  });

  it("sends a validated WebP sticker through the sticker transport", async () => {
    const { store, config } = await setup();
    let sentUrl = "";
    const transport = {
      connected: true,
      sendText: async () => {},
      sendReaction: async () => {},
      sendMedia: async () => {},
      sendSticker: async (_chatId: string, url: string) => { sentUrl = url; },
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "SEND_STICKER" as const, confidence: 1, reason: "sticker reply", mediaUrl: "https://example.com/funny.webp", mediaMimeType: "image/webp", delayMs: 0, needsWeb: false, needsMedia: true, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("sent");
    expect(sentUrl).toBe("https://example.com/funny.webp");
  });

  it("quotes URL media replies", async () => {
    const { store, config } = await setup();
    let quoted: string | undefined;
    const transport = {
      connected: true,
      sendText: async () => {},
      sendReaction: async () => {},
      sendMedia: async (_chatId: string, _url: string, _mimeType: string, _caption?: string, quotedMessageId?: string) => { quoted = quotedMessageId; },
    };
    const service = new ActionService(store, config, transport);
    const plan = { decision: "SEND_IMAGE" as const, confidence: 1, reason: "image reply", mediaUrl: "https://example.com/image.png", mediaMimeType: "image/png", text: "Here it is.", delayMs: 0, needsWeb: false, needsMedia: true, responseStyle: "short_casual" as const };
    expect((await service.execute(plan, source, group)).reason).toBe("sent");
    expect(quoted).toBe(source.id);
  });

  it("rejects private and credential-bearing media URLs", async () => {
    const { store, config } = await setup();
    const transport = { connected: true, sendText: async () => {}, sendReaction: async () => {}, sendMedia: async () => {} };
    const service = new ActionService(store, config, transport);
    const base = { decision: "SEND_IMAGE" as const, confidence: 1, reason: "test", text: "", delayMs: 0, needsWeb: false, needsMedia: true, responseStyle: "short_casual" as const, mediaMimeType: "image/png" };
    expect((await service.execute({ ...base, mediaUrl: "https://127.0.0.1/image.png" }, source, group)).reason).toBe("safe_media_url_required");
    expect((await service.execute({ ...base, mediaUrl: "https://user:pass@example.com/image.png" }, source, group)).reason).toBe("safe_media_url_required");
  });
});
