import { describe, expect, it } from "vitest";
import { localRelevance } from "../src/decision.js";
import { defaultPersonality, previewPersonality, resolvePersonality, responsePolicy } from "../src/persona.js";
import { SkillExecutor, SkillRegistry } from "../src/skills.js";

describe("persona behavior", () => {
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

  it("previews a configured persona in first person", () => {
    const preview = previewPersonality("What are you doing?", { ...defaultPersonality("Sarah"), tone: "playful", languageMix: "pidgin", humorLevel: 0.8 });
    expect(preview).toContain("I");
    expect(preview).not.toContain("Sarah thinks");
  });
});

describe("skill registry and executor", () => {
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
