import { describe, expect, it } from "vitest";
import { normalizeMessage, normalizeFailureReason } from "../src/normalize.js";

describe("normalization never throws on real WhatsApp shapes", () => {
  it("handles @lid chatId with no pushName and an ephemeral wrapper", () => {
    const m = normalizeMessage({
      key: { remoteJid: "200670317695021@lid", id: "A1", fromMe: false, remoteJidAlt: "2348000000001@s.whatsapp.net" } as never,
      message: { ephemeralMessage: { message: { extendedTextMessage: { text: "hi" } } } } as never,
      pushName: null,
    });
    expect(m?.chatId).toBe("200670317695021@lid");
    expect(m?.senderPhone).toBe("2348000000001@s.whatsapp.net");
    expect(m?.text).toBe("hi");
    expect(m?.senderName).toBeUndefined();
  });

  it("survives null/undefined fields and viewOnce wrappers", () => {
    expect(() => normalizeMessage({ key: { remoteJid: null, id: "x" } } as never)).not.toThrow();
    expect(normalizeMessage({ key: { remoteJid: "1@s.whatsapp.net", id: "x" }, message: null } as never)).toBeUndefined();
    const m = normalizeMessage({
      key: { remoteJid: "g@g.us", id: "y", participant: null } as never,
      message: { viewOnceMessageV2: { message: null } } as never,
      messageTimestamp: null,
    });
    expect(m?.isGroup).toBe(true);
    expect(normalizeFailureReason({ key: { remoteJid: "a@lid" } } as never)).toBe("missing_key");
  });

  it("does not throw when resolver throws", () => {
    expect(() => normalizeMessage({ key: { remoteJid: "1@lid", id: "z" }, message: { conversation: "yo" } } as never, undefined, () => { throw new Error("x"); })).not.toThrow();
  });
});
