import { describe, expect, it } from "vitest";
import { personaInstructions, defaultPersonality, resolvePersonality } from "../src/persona.js";
import { characterInstructions, FOLK_CHARACTER, KOLA_CHARACTER, UNIVERSAL_ANTI_BOT_RULES } from "../src/character.js";

describe("persona mode switching", () => {
  it("defaults to kola and keeps kola's persona block", () => {
    const persona = defaultPersonality("Kola");
    expect(persona.personaMode).toBe("kola");
    const lines = characterInstructions("Kola", "kola");
    expect(lines).toEqual(expect.arrayContaining(KOLA_CHARACTER.slice(1)));
    expect(lines).not.toEqual(expect.arrayContaining([FOLK_CHARACTER[0]]));
  });

  it("folk mode swaps the persona block but keeps shared anti-bot rules", () => {
    const lines = characterInstructions("Kola", "folk");
    expect(lines).toEqual(expect.arrayContaining([...UNIVERSAL_ANTI_BOT_RULES, ...FOLK_CHARACTER]));
    expect(lines).not.toEqual(expect.arrayContaining([KOLA_CHARACTER[1]]));
    expect(lines.join(" ")).toContain("lowercase");
  });

  it("custom mode uses the admin prompt and drops the built-in personas", () => {
    const lines = characterInstructions("Kola", "custom", "  talk like a pirate who codes  ");
    expect(lines).toEqual(expect.arrayContaining(UNIVERSAL_ANTI_BOT_RULES));
    expect(lines).toContain("Custom persona set by the admin: talk like a pirate who codes");
    expect(lines).not.toEqual(expect.arrayContaining([KOLA_CHARACTER[1], FOLK_CHARACTER[0]]));
  });

  it("custom mode with empty prompt adds no persona text", () => {
    const lines = characterInstructions("Kola", "custom", "   ");
    expect(lines).toEqual([...UNIVERSAL_ANTI_BOT_RULES]);
  });

  it("personaInstructions reads the mode live from the personality object", () => {
    const base = defaultPersonality("Kola");
    const folk = resolvePersonality(base, { personaMode: "folk" });
    const custom = resolvePersonality(base, { personaMode: "custom", customPersonaPrompt: "be a sports pundit" });
    expect(personaInstructions(folk).join(" ")).toContain("lowercase");
    expect(personaInstructions(custom).join(" ")).toContain("be a sports pundit");
    expect(personaInstructions(custom).join(" ")).not.toContain(KOLA_CHARACTER[1]);
    const back = resolvePersonality(custom, { personaMode: "kola" });
    expect(personaInstructions(back).join(" ")).toContain(KOLA_CHARACTER[1]);
  });

  it("folk and custom keep the same hard lines as kola", () => {
    for (const mode of ["kola", "folk", "custom"] as const) {
      expect(characterInstructions("Kola", mode, "x").join(" ")).toMatch(/Hard lines for every persona/);
    }
    expect(characterInstructions("Kola", "folk").join(" ")).toMatch(/Never break character/);
    expect(FOLK_CHARACTER.join(" ")).toMatch(/Never at bodies/);
  });
});
