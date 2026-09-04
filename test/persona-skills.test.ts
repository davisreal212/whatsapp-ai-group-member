import { describe, expect, it } from "vitest";
import { localRelevance } from "../src/decision.js";
import { applyLanguagePreference, defaultPersonality, languageLabel, migrateLegacyPersonality, parseLanguageCommand, parseLanguageTask, previewPersonality, resolvePersonality, responsePolicy } from "../src/persona.js";
import { SUPPORTED_LANGUAGE_COUNT, normalizeLanguageName } from "../src/languages.js";
import { SkillExecutor, SkillRegistry, createCoreSkillRegistry } from "../src/skills.js";

describe("persona behavior", () => {
  it("defaults to English and treats it as an output-language lock", () => {
    const persona = defaultPersonality("Kola");
    expect(persona).toMatchObject({ languageMix: "english", languages: ["english"] });
    expect(resolvePersonality({ ...persona, languageMix: "mixed", languages: ["english", "nigerian pidgin"] }, { languageMix: "english", languages: ["english", "nigerian pidgin"] })).toMatchObject({ languageMix: "english", languages: ["english"] });
    expect(previewPersonality("What are you doing?", applyLanguagePreference({ ...persona, languageMix: "mixed", languages: ["english", "nigerian pidgin"] }, "english"))).not.toContain("dey");
  });

  it("migrates the previous mixed default without changing an intentional preset", () => {
    expect(migrateLegacyPersonality({ displayName: "Kola", languageMix: "mixed", languages: ["english", "nigerian pidgin"], personalityPresets: [] })).toMatchObject({ languageMix: "english", languages: ["english"] });
    expect(migrateLegacyPersonality({ displayName: "Kola", languageMix: "mixed", languages: ["english", "nigerian pidgin"], personalityPresets: ["Street"] })).toMatchObject({ languageMix: "mixed" });
  });

  it("parses explicit language commands", () => {
    expect(parseLanguageCommand("language english")).toBe("english");
    expect(parseLanguageCommand("set my language to pidgin")).toBe("pidgin");
    expect(parseLanguageCommand("Always communicate in Chinese from now on")).toBe("chinese");
    expect(parseLanguageCommand("language auto")).toBe("auto");
    expect(parseLanguageCommand("/language")).toBe("help");
    expect(parseLanguageCommand("I speak English")).toBeUndefined();
    expect(languageLabel("chinese")).toBe("Chinese");
  });

  it("parses translation and analysis requests", () => {
    expect(parseLanguageTask("translate to Chinese: Good morning")).toEqual({ kind: "translate", targetLanguage: "chinese", text: "Good morning" });
    expect(parseLanguageTask("translate: Good morning")).toEqual({ kind: "translate", text: "Good morning" });
    expect(parseLanguageTask("analyse: this message")).toEqual({ kind: "analyze", text: "this message" });
    expect(parseLanguageTask("summarize: this message")).toEqual({ kind: "summarize", text: "this message" });
  });

  it("supports the broad language catalog", () => {
    expect(SUPPORTED_LANGUAGE_COUNT).toBeGreaterThanOrEqual(100);
    expect(normalizeLanguageName("Haitian Creole")).toBe("haitian_creole");
    expect(applyLanguagePreference(defaultPersonality("Kola"), "japanese")).toMatchObject({ languageMix: "japanese", languages: ["japanese"] });
  });

  it("resolves preset expression without changing safety controls", () => {
    const resolved = resolvePersonality(defaultPersonality("Kola"), {
      displayName: "Sarah",
      personalityPresets: ["Funny", "Friendly"],
      humorLevel: 0.9,
    });

    expect(resolved).toMatchObject({ displayName: "Sarah", tone: "warm", humorLevel: 0.9, respondToMentions: true, memoryEnabled: true });
    expect(resolved.personalityPresets).toEqual(["Funny", "Friendly"]);
  });

  it("keeps direct mention and reply controls in the response policy", () => {
    const persona = { ...defaultPersonality("Kola"), respondToMentions: false, respondToReplies: false };
    const message = { id: "message", chatId: "group@g.us", groupId: "group@g.us", senderId: "member", timestamp: Date.now(), type: "text" as const, text: "@Kola hello", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    const local = localRelevance(message, "Kola", undefined, 0.5, [], false, persona);
    expect(local).toMatchObject({ relevant: false, reason: "mentions_disabled", directed: true });
    expect(responsePolicy(persona, message, { directed: true, directReply: false, directMention: true, mentionAll: false, priority: "HIGH" }, true).shouldReply).toBe(false);
  });

  it("leaves substantive group relevance to the classifier instead of the join toggle", () => {
    const persona = defaultPersonality("Kola");
    const message = { id: "message", chatId: "group@g.us", groupId: "group@g.us", senderId: "member", timestamp: Date.now(), type: "text" as const, text: "The meeting starts at eight tonight", mentionedIds: [], isGroup: true, isStatus: false, isFromBot: false };
    expect(responsePolicy(persona, message, { directed: false, directReply: false, directMention: false, mentionAll: false, priority: "NORMAL" }, true).shouldReply).toBe(true);
    expect(responsePolicy(persona, message, { directed: false, directReply: false, directMention: false, mentionAll: false, priority: "NORMAL" }, false).shouldReply).toBe(false);
  });

  it("previews a configured persona in first person", () => {
    const preview = previewPersonality("What are you doing?", { ...defaultPersonality("Sarah"), tone: "playful", languageMix: "pidgin", humorLevel: 0.8 });
    expect(preview).toContain("I");
    expect(preview).not.toContain("Sarah thinks");
  });
});

describe("skill registry and executor", () => {
  it("registers the complete blueprint skill catalog", () => {
    const skills = createCoreSkillRegistry().list();
    expect(skills.length).toBeGreaterThanOrEqual(178);
    expect(skills.some((skill) => skill.skillId === "whatsapp_voice_call")).toBe(true);
    expect(skills.some((skill) => skill.skillId === "pending_conversation_recall")).toBe(true);
    expect(skills.every((skill) => skill.skillFile === `skills/${skill.skillId}/SKILL.md`)).toBe(true);
  });

  it("reports only explicitly wired runtime handlers as executable", () => {
    const registry = createCoreSkillRegistry({ voice_call_status: () => ({ success: true, data: "ready" }) });
    expect(registry.list().find((skill) => skill.skillId === "voice_call_status")).toMatchObject({ enabled: true, available: true });
    expect(registry.list().find((skill) => skill.skillId === "calculator")).toMatchObject({ enabled: true, available: false });
  });

  it("discovers skills and enforces permissions before execution", async () => {
    const registry = new SkillRegistry();
    registry.register({
      skillId: "test_skill",
      name: "Test skill",
      description: "A test capability",
      category: "test",
      version: "1.0.0",
      scope: "MESSAGE",
      enabled: true,
      requiresPermission: true,
      supportsChaining: true,
      triggers: ["test"],
      requiredInputs: ["value"],
      optionalInputs: [],
      timeoutMs: 100,
      dependencies: [],
      failureBehavior: "silence",
      learningEnabled: false,
      handler: async (input) => ({ success: true, data: input.value }),
    });
    const executor = new SkillExecutor(registry);

    await expect(executor.execute("test_skill", { value: "x" })).resolves.toMatchObject({ success: false, error: "skill_permission_denied" });
    await expect(executor.execute("test_skill", { value: "x" }, { permissionGranted: true })).resolves.toMatchObject({ success: true, data: "x" });
    expect(registry.discover("test capability")[0]?.skillId).toBe("test_skill");
  });

  it("returns a structured timeout instead of rejecting", async () => {
    const registry = new SkillRegistry();
    registry.register({
      skillId: "slow_skill",
      name: "Slow skill",
      description: "Times out",
      category: "test",
      version: "1.0.0",
      scope: "GLOBAL",
      enabled: true,
      requiresPermission: false,
      supportsChaining: false,
      triggers: [],
      requiredInputs: [],
      optionalInputs: [],
      timeoutMs: 10,
      dependencies: [],
      failureBehavior: "fallback",
      learningEnabled: false,
      handler: () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 50)),
    });

    await expect(new SkillExecutor(registry).execute("slow_skill", {})).resolves.toMatchObject({ success: false, error: "skill_timeout" });
  });
});
