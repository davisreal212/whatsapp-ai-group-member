import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../src/normalize.js";
import { evaluateInboundPolicy } from "../src/policy.js";
import type { AppConfig, GroupRecord } from "../src/types.js";

const config = { groupOnlyMode: true, directMessageAllowlist: [], aiProcessingPaused: false } satisfies Pick<AppConfig, "groupOnlyMode" | "directMessageAllowlist" | "aiProcessingPaused">;
const group: GroupRecord = {
  id: "123@g.us",
  whatsappGroupId: "123@g.us",
  subject: "Test group",
  participantCount: 3,
  isAdmin: true,
  enabled: true,
  aiPaused: false,
  lastSeenAt: Date.now(),
};

describe("message normalization and inbound policy", () => {
  it("normalizes text, mentions, and quote metadata without exposing transport shape", () => {
    const message = normalizeMessage({
      key: { remoteJid: "123@g.us", id: "msg-1", participant: "234@s.whatsapp.net" },
      pushName: "Ada",
      messageTimestamp: 1700000000,
      message: {
        extendedTextMessage: {
          text: "@Kola what is the latest update?",
          contextInfo: {
            stanzaId: "old-msg",
            participant: "bot@s.whatsapp.net",
            mentionedJid: ["bot@s.whatsapp.net"],
          },
        },
      },
    }, "bot@s.whatsapp.net");

    expect(message).toEqual({
      id: "msg-1",
      chatId: "123@g.us",
      groupId: "123@g.us",
      senderId: "234@s.whatsapp.net",
      senderName: "Ada",
      timestamp: 1700000000000,
      type: "text",
      text: "@Kola what is the latest update?",
      quotedMessageId: "old-msg",
      quotedSenderId: "bot@s.whatsapp.net",
      mentionedIds: ["bot@s.whatsapp.net"],
      isGroup: true,
      isStatus: false,
      isFromBot: false,
    });
  });

  it("rejects DMs before any group or AI processing", () => {
    const message = {
      id: "dm-1", chatId: "234@s.whatsapp.net", senderId: "234@s.whatsapp.net", timestamp: Date.now(), type: "text" as const,
      mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false,
    };
    expect(evaluateInboundPolicy(message, undefined, config)).toEqual({ allowed: false, reason: "DIRECT_MESSAGE" });
  });

  it("allows only listed DMs when group-only mode is disabled", () => {
    const message = {
      id: "dm-2", chatId: "234@s.whatsapp.net", senderId: "234@s.whatsapp.net", timestamp: Date.now(), type: "text" as const,
      mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false,
    };
    const dmConfig = { ...config, groupOnlyMode: false, directMessageAllowlist: ["+234"] };
    expect(evaluateInboundPolicy(message, undefined, dmConfig)).toEqual({ allowed: true, reason: "ALLOWED" });
    expect(evaluateInboundPolicy({ ...message, senderId: "235@s.whatsapp.net", chatId: "235@s.whatsapp.net" }, undefined, dmConfig)).toEqual({ allowed: false, reason: "DIRECT_MESSAGE_NOT_ALLOWLISTED" });
  });

  it("defaults unapproved and disabled groups to denial", () => {
    const message = {
      id: "group-1", chatId: group.id, groupId: group.id, senderId: "member", timestamp: Date.now(), type: "text" as const,
      mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false,
    };
    expect(evaluateInboundPolicy(message, undefined, config).reason).toBe("UNAUTHORIZED_GROUP");
    expect(evaluateInboundPolicy(message, { ...group, enabled: false }, config).reason).toBe("DISABLED_GROUP");
    expect(evaluateInboundPolicy(message, group, config)).toEqual({ allowed: true, reason: "ALLOWED" });
  });
});
