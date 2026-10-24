import { describe, expect, it } from "vitest";
import { FALLBACK_VARIANTS, FallbackRotator } from "../src/fallback-lines.js";
import { DecisionEngine } from "../src/decision.js";
import { loadConfig } from "../src/config.js";
import type { ProviderRouter } from "../src/providers.js";

const DAY = 86_400_000;

describe("fallback line rotation", () => {
  it("ships 4-6 variants per kind and no duplicates within a kind", () => {
    for (const kind of Object.keys(FALLBACK_VARIANTS) as Array<keyof typeof FALLBACK_VARIANTS>) {
      const list = FALLBACK_VARIANTS[kind];
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(6);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("never repeats a line to the same person within one day while variants remain", () => {
    let t = Date.parse("2026-10-24T10:00:00Z");
    const rot = new FallbackRotator(() => t);
    const seen: string[] = [];
    for (let i = 0; i < FALLBACK_VARIANTS.voice.length; i++) seen.push(rot.pick("voice", "dami"));
    expect(new Set(seen).size).toBe(FALLBACK_VARIANTS.voice.length);
  });

  it("never returns the same line twice in a row to the same person, even after the cycle resets", () => {
    const rot = new FallbackRotator(() => Date.parse("2026-10-24T10:00:00Z"));
    let prev = "";
    for (let i = 0; i < 40; i++) {
      const line = rot.pick("generic", "dami");
      expect(line).not.toBe(prev);
      prev = line;
    }
  });

  it("tracks people independently", () => {
    const rot = new FallbackRotator(() => Date.parse("2026-10-24T10:00:00Z"));
    const a = rot.pick("image", "alice");
    const b = rot.pick("image", "bob");
    expect(FALLBACK_VARIANTS.image).toContain(a);
    expect(FALLBACK_VARIANTS.image).toContain(b);
    // alice's first and second picks are both recorded against alice, not bob
    const a2 = rot.pick("image", "alice");
    expect(a2).not.toBe(a);
  });

  it("resets the used set on a new day so variants come back", () => {
    let t = Date.parse("2026-10-24T10:00:00Z");
    const rot = new FallbackRotator(() => t);
    for (let i = 0; i < FALLBACK_VARIANTS.voice.length; i++) rot.pick("voice", "dami");
    t += DAY;
    const next = rot.pick("voice", "dami");
    expect(FALLBACK_VARIANTS.voice).toContain(next);
  });

  it("always returns a non-empty line, never silence", () => {
    const rot = new FallbackRotator(() => Date.parse("2026-10-24T10:00:00Z"));
    for (let i = 0; i < 25; i++) expect(rot.pick("voice", "dami").trim().length).toBeGreaterThan(0);
  });
});

describe("voice-specific fallback", () => {
  const voiceLines = FALLBACK_VARIANTS.voice;
  const engine = new DecisionEngine({ classify: async () => undefined } as unknown as ProviderRouter);
  const personality = loadConfig({ NODE_ENV: "test" }).personality;
  const group = { id: "dm@s.whatsapp.net", isGroup: false } as never;
  const context = { group, recentMessages: [], memories: [], personality } as never;

  const dm = (type: "audio" | "text") => ({
    id: `m-${type}-${Math.random()}`, chatId: "dm@s.whatsapp.net", senderId: "2348000000000", timestamp: Date.now(),
    type, text: type === "audio" ? "" : "hi", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false,
    ...(type === "audio" ? { transcriptConfidence: 0 } : {}),
  }) as never;

  it("voice variants all reference the voice, not a generic brain line", () => {
    for (const line of voiceLines) expect(line).toMatch(/voice|ears|say it|type|text/i);
    for (const line of voiceLines) expect(line).not.toMatch(/brain|lagged/i);
  });

  it("a failed voice note in a DM gets a voice-referencing line", async () => {
    const plan = await engine.decide(dm("audio"), group, context, { botName: "kola", alwaysReplyToAllowedDm: true });
    expect(plan.plan.decision).toBe("REPLY");
    expect(voiceLines).toContain(plan.plan.text);
  });

  it("a text DM low-signal fallback does not use the voice pool", async () => {
    const plan = await engine.decide(dm("text"), group, context, { botName: "kola", alwaysReplyToAllowedDm: true });
    expect(voiceLines).not.toContain(plan.plan.text);
  });
});

import { ExcuseLimiter, HOLD_UP_VARIANTS, pickHoldUpLine } from "../src/fallback-lines.js";

describe("excuse rate limit", () => {
  const H = 3_600_000;
  it("allows at most one excuse per sender per hour", () => {
    let t = 0;
    const lim = new ExcuseLimiter(() => t);
    expect(lim.tryUse("dami")).toBe(true);
    t += 10 * 60_000;
    expect(lim.tryUse("dami")).toBe(false);
    t += H;
    expect(lim.tryUse("dami")).toBe(true);
  });
  it("never more than 2 excuses in a row without a real reply", () => {
    let t = 0;
    const lim = new ExcuseLimiter(() => t);
    expect(lim.tryUse("dami")).toBe(true);
    t += H; expect(lim.tryUse("dami")).toBe(true);
    t += H; expect(lim.tryUse("dami")).toBe(false);
    lim.noteRealReply("dami");
    t += H; expect(lim.tryUse("dami")).toBe(true);
  });
  it("tracks senders independently", () => {
    const lim = new ExcuseLimiter(() => 0);
    expect(lim.tryUse("a")).toBe(true);
    expect(lim.tryUse("b")).toBe(true);
  });
});

describe("text-message failure does not use media-fallback lines", () => {
  it("hold-up lines contain no media/brain wording", () => {
    for (const line of HOLD_UP_VARIANTS) expect(line).not.toMatch(/brain|glitch|lagged|buffer|resend|voice|pic|image|eyes|screen/i);
    expect(HOLD_UP_VARIANTS).toContain(pickHoldUpLine("dami"));
  });
  it("an allowlisted text DM with no AI plan never gets a media-failure line", async () => {
    const { DecisionEngine } = await import("../src/decision.js");
    const router = { classify: async () => undefined, generateResponse: async () => undefined } as any;
    const engine = new DecisionEngine(router);
    const cfg: any = { botName: "kola", botJid: "bot@x", alwaysReplyToAllowedDm: true, participation: undefined };
    const ctx: any = { personality: { talkativeness: 0.35, respondToMentions: true, respondToReplies: true, joinRelevantConversations: true, languageMix: "english", languages: ["english"] }, recentActions: [] };
    const msg: any = { id: "m1", chatId: "c1", senderId: "dami-text", isGroup: false, type: "text", text: "Hello", mentionedIds: [] };
    const group: any = { id: "dm" };
    const out = await engine.decide(msg, group, ctx, cfg);
    expect(out.plan.text ?? "").not.toMatch(/brain|glitch|lagged|buffer|resend|voice|eyes|screen/i);
  });
});
