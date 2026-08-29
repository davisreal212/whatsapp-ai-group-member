import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../src/normalize.js";
import { evaluateInboundPolicy } from "../src/policy.js";
import { normalizeWhatsAppJid, sameWhatsAppIdentity } from "../src/identity.js";
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
  it("normalizes device-specific JIDs without conflating LIDs", () => {
    expect(normalizeWhatsAppJid("234:7@S.WHATSAPP.NET")).toBe("234@s.whatsapp.net");
    expect(sameWhatsAppIdentity("234:7@s.whatsapp.net", "234@s.whatsapp.net")).toBe(true);
    expect(sameWhatsAppIdentity("234@lid", "234@s.whatsapp.net")).toBe(false);
  });

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

  it("allows a DM when WhatsApp supplies a LID plus the sender phone number", () => {
    const message = {
      id: "dm-lid", chatId: "1234567890@lid", senderId: "1234567890@lid", senderPhone: "2349067818982@s.whatsapp.net",
      timestamp: Date.now(), type: "text" as const, mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false,
    };
    const dmConfig = { ...config, groupOnlyMode: false, directMessageAllowlist: ["+2349067818982"] };
    expect(evaluateInboundPolicy(message, undefined, dmConfig)).toEqual({ allowed: true, reason: "ALLOWED" });
  });

  it("preserves the phone JID supplied alongside a LID", () => {
    const message = normalizeMessage({
      key: {
        remoteJid: "1234567890@lid",
        id: "dm-lid-1",
        senderPn: "2349067818982@s.whatsapp.net",
      },
      message: { conversation: "hello" },
    });
    expect(message?.senderId).toBe("1234567890@lid");
    expect(message?.senderPhone).toBe("2349067818982@s.whatsapp.net");
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

  it("accepts message types it does not need to interpret locally", () => {
    const message = {
      id: "location-1", chatId: group.id, groupId: group.id, senderId: "member", timestamp: Date.now(), type: "unknown" as const,
      mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false,
    };
    expect(evaluateInboundPolicy(message, group, config)).toEqual({ allowed: true, reason: "ALLOWED" });
  });
});
