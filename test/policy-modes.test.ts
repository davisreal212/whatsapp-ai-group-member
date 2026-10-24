import { describe, expect, it } from "vitest";
import { evaluateInboundPolicy } from "../src/policy.js";
import { loadConfig } from "../src/config.js";
import type { CanonicalMessage, GroupRecord } from "../src/types.js";

const base = { groupOnlyMode: false, directMessageAllowlist: ["+2349071419245"], aiProcessingPaused: false };
const dm = (senderPhone: string): CanonicalMessage =>
  ({ id: "m1", chatId: `${senderPhone}@s.whatsapp.net`, senderId: `${senderPhone}@s.whatsapp.net`, senderPhone, isGroup: false, isStatus: false, isFromBot: false, text: "hi", timestamp: Date.now() }) as unknown as CanonicalMessage;
const groupMsg: CanonicalMessage = { id: "g1", chatId: "123@g.us", groupId: "123@g.us", senderId: "x@s.whatsapp.net", senderPhone: "2340000", isGroup: true, isStatus: false, isFromBot: false, text: "hi", timestamp: Date.now() } as unknown as CanonicalMessage;
const enabledGroup: GroupRecord = { id: "123@g.us", whatsappGroupId: "123@g.us", subject: "g", participantCount: 3, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
const disabledGroup: GroupRecord = { ...enabledGroup, enabled: false };

describe("DM policy mode", () => {
  it("allowlist mode (default) rejects non-allowlisted DMs and accepts allowlisted ones", () => {
    expect(evaluateInboundPolicy(dm("2341111"), undefined, { ...base, dmPolicy: "allowlist" }).reason).toBe("DIRECT_MESSAGE_NOT_ALLOWLISTED");
    expect(evaluateInboundPolicy(dm("2349071419245"), undefined, { ...base, dmPolicy: "allowlist" })).toEqual({ allowed: true, reason: "ALLOWED" });
  });

  it("omitted dmPolicy behaves as allowlist", () => {
    expect(evaluateInboundPolicy(dm("2341111"), undefined, base).allowed).toBe(false);
  });

  it("all mode replies to any DM, even non-allowlisted, and even in group-only mode", () => {
    expect(evaluateInboundPolicy(dm("2341111"), undefined, { ...base, dmPolicy: "all" })).toEqual({ allowed: true, reason: "ALLOWED" });
    expect(evaluateInboundPolicy(dm("2341111"), undefined, { ...base, groupOnlyMode: true, dmPolicy: "all" })).toEqual({ allowed: true, reason: "ALLOWED" });
  });

  it("the allowlist no longer gates DMs in all mode, but still ignores the allowlist when it is empty", () => {
    expect(evaluateInboundPolicy(dm("2341111"), undefined, { ...base, directMessageAllowlist: [], dmPolicy: "all" }).allowed).toBe(true);
  });

  it("pausing AI still blocks DMs in all mode", () => {
    expect(evaluateInboundPolicy(dm("2341111"), undefined, { ...base, aiProcessingPaused: true, dmPolicy: "all" }).reason).toBe("AI_PROCESSING_PAUSED");
  });
});

describe("group policy mode", () => {
  it("allowlisted mode (default) drops groups that are not enabled/allowlisted", () => {
    expect(evaluateInboundPolicy(groupMsg, disabledGroup, { ...base, groupPolicy: "allowlisted" }).reason).toBe("DISABLED_GROUP");
    expect(evaluateInboundPolicy(groupMsg, enabledGroup, { ...base, groupPolicy: "allowlisted" }).allowed).toBe(true);
    expect(evaluateInboundPolicy(groupMsg, undefined, { ...base, groupPolicy: "allowlisted" }).reason).toBe("UNAUTHORIZED_GROUP");
  });

  it("all mode replies in an enabled or disabled synced group", () => {
    expect(evaluateInboundPolicy(groupMsg, disabledGroup, { ...base, groupPolicy: "all" }).allowed).toBe(true);
    expect(evaluateInboundPolicy(groupMsg, enabledGroup, { ...base, groupPolicy: "all" }).allowed).toBe(true);
  });

  it("all mode still respects a paused group and unknown groups", () => {
    expect(evaluateInboundPolicy(groupMsg, { ...disabledGroup, aiPaused: true }, { ...base, groupPolicy: "all" }).reason).toBe("GROUP_PAUSED");
    expect(evaluateInboundPolicy(groupMsg, undefined, { ...base, groupPolicy: "all" }).reason).toBe("UNAUTHORIZED_GROUP");
  });

  it("group mode does not change DM handling", () => {
    expect(evaluateInboundPolicy(dm("2341111"), undefined, { ...base, groupPolicy: "all" }).reason).toBe("DIRECT_MESSAGE_NOT_ALLOWLISTED");
  });
});

describe("policy config defaults", () => {
  it("defaults to allowlist DMs and allowlisted groups", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.dmPolicy).toBe("allowlist");
    expect(config.groupPolicy).toBe("allowlisted");
  });
});
