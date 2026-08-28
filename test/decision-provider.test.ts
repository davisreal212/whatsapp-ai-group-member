import { describe, expect, it } from "vitest";
import { localRelevance, parseDecisionPlan } from "../src/decision.js";
import { isCurrentInformationQuestion } from "../src/policy.js";
import { normalizePairingPhoneNumber } from "../src/whatsapp.js";

describe("decision safety helpers", () => {
  it("parses only the supported structured action vocabulary", () => {
    const plan = parseDecisionPlan('```json\n{"decision":"IGNORE","confidence":0.8,"reason":"uncertain","delayMs":0,"needsWeb":false,"needsMedia":false,"responseStyle":"uncertain"}\n```');
    expect(plan.decision).toBe("IGNORE");
    expect(() => parseDecisionPlan({ decision: "DELETE_GROUP", confidence: 1, reason: "bad", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" })).toThrow();
  });

  it("recognizes direct addressing and current-fact questions locally", () => {
    const message = { id: "1", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "@Kola is this true?", mentionedIds: ["bot@s.whatsapp.net"], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", "bot@s.whatsapp.net").directed).toBe(true);
    expect(isCurrentInformationQuestion(message.text)).toBe(true);
  });

  it("formats pairing numbers as the Baileys API requires", () => {
    expect(normalizePairingPhoneNumber("+234 (801) 555-0100")).toBe("2348015550100");
  });
});
