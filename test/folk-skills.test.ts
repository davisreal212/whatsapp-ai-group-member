import { describe, expect, it } from "vitest";
import { skillHintsForMode } from "../src/persona.js";
import { createCoreSkillRegistry } from "../src/skills.js";

describe("folk mode skill hints", () => {
  const registry = createCoreSkillRegistry();
  const all = registry.list();
  const discovered = registry.discover("bitcoin price");

  it("folk mode hints every catalog skill even when toggles are off", () => {
    for (const skill of all) registry.setEnabled(skill.skillId, false);
    const hints = skillHintsForMode("folk", registry.discover("bitcoin price"), registry.list());
    expect(hints.length).toBe(all.length);
    expect(hints.map((hint) => hint.skillId).sort()).toEqual(all.map((skill) => skill.skillId).sort());
  });

  it("kola keeps the toggle-driven top-8 discovery", () => {
    const hints = skillHintsForMode("kola", discovered, all);
    expect(hints).toEqual(discovered.slice(0, 8).map(({ skillId, name, description, category, scope, skillFile }) => ({ skillId, name, description, category, scope, ...(skillFile ? { skillFile } : {}) })));
    expect(hints.length).toBeLessThanOrEqual(8);
  });

  it("undefined mode (legacy settings) behaves like kola", () => {
    expect(skillHintsForMode(undefined, discovered, all).length).toBe(Math.min(8, discovered.length));
  });
});
