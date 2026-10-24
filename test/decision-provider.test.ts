import { describe, expect, it } from "vitest";
import { DecisionEngine, localRelevance, parseDecisionPlan } from "../src/decision.js";
import { loadConfig } from "../src/config.js";
import { isCurrentInformationQuestion } from "../src/policy.js";
import { OpenAICompatibleProvider, ProviderRouter, type AIProvider } from "../src/providers.js";
import { FileStore } from "../src/store.js";
import type { ContextSnapshot } from "../src/memory.js";
import type { DecisionPlan, GroupRecord } from "../src/types.js";
import { normalizePairingPhoneNumber } from "../src/whatsapp.js";
import { isTopicStopRequest, topicTerms } from "../src/bot.js";

class ProviderProbe extends OpenAICompatibleProvider {
  run(): Promise<string> {
    return this.complete("prompt", true);
  }
}

describe("decision safety helpers", () => {
  it("parses only the supported structured action vocabulary", () => {
    const plan = parseDecisionPlan('```json\n{"decision":"IGNORE","confidence":0.8,"reason":"uncertain","delayMs":0,"needsWeb":false,"needsMedia":false,"responseStyle":"uncertain"}\n```');
    expect(plan.decision).toBe("IGNORE");
    expect(() => parseDecisionPlan({ decision: "DELETE_GROUP", confidence: 1, reason: "bad", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" })).toThrow();
  });

  it("bounds oversized classifier text instead of failing the whole decision", () => {
    const plan = parseDecisionPlan({ decision: "REPLY", confidence: 1, reason: "answer", text: "x".repeat(2_500), delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" });
    expect(plan.text).toHaveLength(2_000);
  });

  it("normalizes equivalent response style names returned by providers", () => {
    const plan = parseDecisionPlan({ decision: "REPLY", confidence: 0.9, reason: "answer", text: "Hi", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short-casual" });
    expect(plan.responseStyle).toBe("short_casual");
    expect(parseDecisionPlan({ decision: "REPLY", confidence: 0.9, reason: "answer", text: "Hi", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "detailed" }).responseStyle).toBe("helpful");
    expect(parseDecisionPlan({ decision: "REPLY", confidence: 0.9, reason: "answer", text: "Hi", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "unknown-style" }).responseStyle).toBe("short_casual");
  });

  it("extracts a decision object when a provider adds a short preamble", () => {
    const plan = parseDecisionPlan('Here is the JSON:\n{"decision":"IGNORE","confidence":1,"reason":"quiet","delayMs":0,"needsWeb":false,"needsMedia":false,"responseStyle":"short_casual"}');
    expect(plan.decision).toBe("IGNORE");
  });

  it("retries OpenRouter with its free model after a credit rejection", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(String(init?.body));
      if (requests.length === 1) return new Response(null, { status: 402 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"IGNORE\",\"confidence\":1,\"reason\":\"quiet\"}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const provider = new ProviderProbe("openrouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini", "test-key", "z-ai/glm-5.2:free");
      await expect(provider.run()).resolves.toContain('"decision":"IGNORE"');
      expect(JSON.parse(requests[0]).model).toBe("openai/gpt-4o-mini");
      expect(JSON.parse(requests[1]).model).toBe("z-ai/glm-5.2:free");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes current sender and reply metadata into the classifier prompt", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody = "";
    globalThis.fetch = (async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"decision":"IGNORE","confidence":1,"reason":"other member"}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const provider = new ProviderProbe("groq", "https://api.groq.com/openai/v1", "test-model", "test-key");
      await provider.classify({ messageId: "current", senderId: "member-2", messageText: "That chart looks good", messageType: "text", directed: false, quotedMessageId: "chart", quotedSenderId: "member-1", mentionedIds: [], context: { personality: loadConfig({ NODE_ENV: "test" }).personality } as ContextSnapshot });
      const prompt = JSON.parse(requestBody).messages[0].content as string;
      expect(prompt).toContain("Current message ID: current");
      expect(prompt).toContain("Current sender ID: member-2");
      expect(prompt).toContain("Reply target sender ID: member-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("anchors provider-selected targets to the current message", async () => {
    const message = { id: "current-message", chatId: "g@g.us", groupId: "g@g.us", senderId: "member", timestamp: Date.now(), type: "text" as const, text: "@Kola reply", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const plan: DecisionPlan = { decision: "REPLY_QUOTED", confidence: 1, reason: "reply", targetMessageId: "invented-id", text: "Reply", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 1, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const context: ContextSnapshot = { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality };
    const router = { classify: async () => plan } as unknown as ProviderRouter;
    const result = await new DecisionEngine(router).decide(message, group, context, { botName: "Kola" });
    expect(result.plan.targetMessageId).toBe(message.id);
  });

  it("recognizes direct addressing and current-fact questions locally", () => {
    const message = { id: "1", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "@Kola is this true?", mentionedIds: ["bot@s.whatsapp.net"], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", "bot@s.whatsapp.net").directed).toBe(true);
    expect(isCurrentInformationQuestion(message.text)).toBe(true);
  });

  it("does not treat an unquoted short follow-up as a bot request", () => {
    const message = { id: "bot-follow-up", chatId: "g@g.us", groupId: "g@g.us", senderId: "member", timestamp: Date.now(), type: "text" as const, text: "lol", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", undefined, 0.1, [], false, undefined, [{ id: "action", type: "REPLY", text: "That was funny", timestamp: Date.now() - 1_000, sourceMessageId: "prior", role: "bot" }])).toMatchObject({ relevant: true, reason: "group_message_candidate" });
  });

  it("keeps explicit image requests relevant and high priority", () => {
    const message = { id: "image-request", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Send me us president picture", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola")).toMatchObject({ relevant: true, reason: "media_request", directed: true, priority: "HIGH" });
  });

  it("keeps link analysis and music requests relevant in groups", () => {
    const link = { id: "link-request", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Please analyze this brand https://example.com", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const music = { ...link, id: "music-request", text: "Recommend a workout song" };
    expect(localRelevance(link, "Kola")).toMatchObject({ relevant: true, reason: "link_analysis_request", directed: true });
    expect(localRelevance(music, "Kola")).toMatchObject({ relevant: true, reason: "music_request", directed: true });
  });

  it("creates a sticker action when no classifier is available", async () => {
    const message = { id: "sticker-request", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Send me a funny sticker", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 1, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const result = await new DecisionEngine({ classify: async () => undefined } as unknown as ProviderRouter).decide(message, group, { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality }, { botName: "Kola" });
    expect(result.plan).toMatchObject({ decision: "SEND_STICKER", needsMedia: true, reason: "local_sticker_request" });
  });

  it("falls back to an image action when AI classification is unavailable", async () => {
    const message = { id: "image-request-fallback", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Send me us president picture", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 1, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const result = await new DecisionEngine({ classify: async () => undefined } as unknown as ProviderRouter).decide(message, group, { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality }, { botName: "Kola" });
    expect(result.plan).toMatchObject({ decision: "SEND_IMAGE", needsMedia: true, reason: "local_media_request" });
  });

  it("does not let an AI ignore explicit image requests", async () => {
    const message = { id: "image-request-ignore", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Show me a photo of the president", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 1, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const result = await new DecisionEngine({ classify: async () => ({ decision: "IGNORE", confidence: 1, reason: "quiet", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const }) } as unknown as ProviderRouter).decide(message, group, { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality }, { botName: "Kola" });
    expect(result.plan).toMatchObject({ decision: "SEND_IMAGE", needsMedia: true, reason: "local_media_request" });
  });

  it("ignores standalone inbound stickers and images", () => {
    const message = { id: "sticker-1", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "sticker" as const, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const image = { ...message, id: "image-1", type: "image" as const };
    expect(localRelevance(message, "Kola")).toMatchObject({ relevant: false, reason: "standalone_media" });
    expect(localRelevance(image, "Kola")).toMatchObject({ relevant: false, reason: "standalone_media" });
  });

  it("recognizes plain-name and LID-based direct addressing", () => {
    const message = { id: "2", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Kola, what do you think?", mentionedIds: ["bot-lid@lid"], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", "bot@s.whatsapp.net", 0.35, ["bot-lid@lid"]).directed).toBe(true);
  });

  it("forces an allowlisted DM through the response path", () => {
    const message = { id: "dm-message", chatId: "user@s.whatsapp.net", senderId: "user@s.whatsapp.net", timestamp: Date.now(), type: "text" as const, text: "just checking in", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", undefined, 0.1, [], true)).toEqual({ relevant: true, reason: "allowlisted_dm", directed: true });
  });

  it("lets substantive group conversation reach the classifier", () => {
    const message = { id: "3", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "The meeting starts at eight tonight", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", undefined, 0.1).reason).toBe("group_message_candidate");
  });

  it("lets the classifier decide whether an unaddressed substantive group message matters", async () => {
    const message = { id: "candidate", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "The meeting starts at eight tonight", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 2, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    let calls = 0;
    const result = await new DecisionEngine({ classify: async () => { calls += 1; return { decision: "IGNORE", confidence: 1, reason: "not useful", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const }; } } as unknown as ProviderRouter).decide(message, group, { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality }, { botName: "Kola" });
    expect(calls).toBe(1);
    expect(result.usedAi).toBe(true);
    expect(result.local.reason).toBe("group_message_candidate");
    expect(result.plan.decision).toBe("IGNORE");
  });

  it("sends unaddressed group greetings to the classifier instead of dropping them locally", () => {
    const message = { id: "greeting", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "Good morning y'all", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", undefined, 0.1)).toMatchObject({ relevant: true, reason: "group_message_candidate" });
  });

  it("sends short unrelated group messages to the classifier instead of dropping them locally", () => {
    const message = { id: "short-message", chatId: "g@g.us", groupId: "g@g.us", senderId: "u", timestamp: Date.now(), type: "text" as const, text: "okay", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    expect(localRelevance(message, "Kola", undefined, 0.1)).toMatchObject({ relevant: true, reason: "group_message_candidate", directed: false });
  });

  it("never lets the classifier silence an allowlisted DM", async () => {
    const message = { id: "dm-allow", chatId: "2349071419245@s.whatsapp.net", senderId: "2349071419245@s.whatsapp.net", timestamp: Date.now(), type: "text" as const, text: "yo", mentionedIds: [], isGroup: false, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "2349071419245@s.whatsapp.net", whatsappGroupId: "2349071419245@s.whatsapp.net", subject: "dm", participantCount: 1, isAdmin: false, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const result = await new DecisionEngine({ classify: async () => ({ decision: "IGNORE", confidence: 1, reason: "quiet", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const }) } as unknown as ProviderRouter).decide(message, group, { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality }, { botName: "Kola", alwaysReplyToAllowedDm: true });
    expect(result.plan.decision).toBe("REPLY");
  });

  it("recognizes a request to stop repeating a topic", () => {
    expect(isTopicStopRequest("Please stop mentioning the 5k to 68k plan")).toBe(true);
    expect(isTopicStopRequest("Please stop")).toBe(true);
    expect(topicTerms("stop mentioning the 5k-to-68k plan")).toEqual(expect.arrayContaining(["5k", "68k", "plan"]));
  });

  it("turns a provider ignore into a response plan for a direct address", async () => {
    const message = { id: "direct-message", chatId: "g@g.us", groupId: "g@g.us", senderId: "member", timestamp: Date.now(), type: "text" as const, text: "Kola, help me", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 1, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const context: ContextSnapshot = { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality };
    const router = { classify: async () => ({ decision: "IGNORE", confidence: 1, reason: "quiet", delayMs: 0, needsWeb: false, needsMedia: false, responseStyle: "short_casual" as const }) } as unknown as ProviderRouter;
    const result = await new DecisionEngine(router).decide(message, group, context, { botName: "Kola", botJids: [] });
    expect(result.plan.decision).toBe("REPLY");
  });

  it("formats pairing numbers as the Baileys API requires", () => {
    expect(normalizePairingPhoneNumber("+234 (801) 555-0100")).toBe("2348015550100");
  });

  it("opens a provider circuit after repeated failures", async () => {
    let calls = 0;
    const failing: AIProvider = {
      name: "groq",
      model: "test",
      available: true,
      classify: async () => { calls += 1; throw new Error("quota exceeded"); },
      generateResponse: async () => undefined,
    };
    const router = new ProviderRouter(new FileStore(`/tmp/provider-circuit-${Date.now()}`), loadConfig({ NODE_ENV: "test", PROVIDER_FAILURE_THRESHOLD: "2", PROVIDER_COOLDOWN_MS: "60000" }), [failing]);
    const input = { messageText: "hello", messageType: "text", directed: true, context: {} as ContextSnapshot };
    await router.classify(input);
    await router.classify(input);
    await router.classify(input);
    expect(calls).toBe(2);
    expect(router.statuses()[0]).toMatchObject({ healthy: false, consecutiveFailures: 2, lastError: "quota exceeded" });
  });

  it("opens a provider circuit immediately after a timeout", async () => {
    let calls = 0;
    const failing: AIProvider = {
      name: "phoenix-deepseek",
      model: "test",
      available: true,
      classify: async () => { calls += 1; throw new Error("The operation was aborted due to timeout"); },
      generateResponse: async () => undefined,
    };
    const router = new ProviderRouter(new FileStore(`/tmp/provider-timeout-${Date.now()}`), loadConfig({ NODE_ENV: "test", PROVIDER_FAILURE_THRESHOLD: "3", PROVIDER_COOLDOWN_MS: "60000" }), [failing]);
    const input = { messageText: "hello", messageType: "text", directed: true, context: {} as ContextSnapshot };
    await router.classify(input);
    await router.classify(input);
    expect(calls).toBe(1);
    expect(router.statuses()[0]?.healthy).toBe(false);
  });

  it("bounds a provider operation and records the timeout without removing fallback providers", async () => {
    const pending: AIProvider = {
      name: "phoenix-deepseek",
      model: "deepseek-v4-flash",
      available: true,
      classify: async () => new Promise<DecisionPlan>(() => {}),
      generateResponse: async () => undefined,
    };
    const config = loadConfig({ NODE_ENV: "test", AI_OPERATION_TIMEOUT_MS: "5000", PROVIDER_COOLDOWN_MS: "60000" });
    config.aiOperationTimeouts.classifyMs = 20;
    const router = new ProviderRouter(new FileStore(`/tmp/provider-operation-timeout-${Date.now()}`), config, [pending]);
    const input = { messageText: "hello", messageType: "text", directed: true, context: {} as ContextSnapshot };
    const startedAt = Date.now();
    await expect(router.classify(input)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(router.statuses()[0]).toMatchObject({ healthy: false, lastError: expect.stringMatching(/timed out/) });
  });

  it("keeps every configured response provider in the router", () => {
    const router = new ProviderRouter(new FileStore(`/tmp/provider-models-${Date.now()}`), loadConfig({
      NODE_ENV: "test",
      PHOENIX_API_KEY: "phoenix",
      GROQ_API_KEY: "groq",
      GEMINI_API_KEY: "gemini",
      OPENROUTER_API_KEY: "openrouter",
    }));
    expect(router.statuses().map((provider) => `${provider.name}:${provider.model}`)).toEqual([
      "phoenix-pool:gpt-6-astra",
      "groq:openai/gpt-oss-20b",
      "gemini:gemini-3.6-flash",
      "openrouter:z-ai/glm-5.2:free",
    ]);
  });

  it("asks for a resend when a voice transcript is unreliable", async () => {
    const message = { id: "voice-1", chatId: "g@g.us", groupId: "g@g.us", senderId: "member", timestamp: Date.now(), type: "audio" as const, text: "unclear words", transcriptConfidence: 0.2, mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const group: GroupRecord = { id: "g@g.us", whatsappGroupId: "g@g.us", subject: "Test", participantCount: 1, isAdmin: true, enabled: true, aiPaused: false, lastSeenAt: Date.now() };
    const result = await new DecisionEngine({ classify: async () => { throw new Error("should not call provider"); } } as unknown as ProviderRouter).decide(message, group, { group, recentMessages: [], memories: [], personality: loadConfig({ NODE_ENV: "test" }).personality }, { botName: "Kola" });
    expect(result.usedAi).toBe(false);
    expect(result.plan.reason).toBe("low_transcript_confidence");
  });
});
