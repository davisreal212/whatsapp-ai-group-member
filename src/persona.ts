import { z } from "zod";
import type { CanonicalMessage, LanguagePreference, Personality } from "./types.js";
import type { ParticipationSignals } from "./participation.js";

const ratio = z.preprocess((value) => {
  const number = typeof value === "number" ? value : Number(value);
  return number > 1 ? number / 100 : number;
}, z.number().min(0).max(1));

const language = z.string().trim().min(2).max(40);

export const languagePreferenceSchema = z.enum(["english", "pidgin", "mixed"]);

export const personalityPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  genderPresentation: z.enum(["neutral", "masculine", "feminine", "custom"]),
  tone: z.enum(["casual", "playful", "warm", "formal"]),
  talkativeness: ratio,
  confidence: ratio,
  formality: ratio,
  languageMix: z.enum(["english", "pidgin", "mixed"]),
  emojiFrequency: ratio,
  initiative: ratio,
  responseLength: z.enum(["short", "medium", "long"]),
  customDescription: z.string().trim().max(1_000),
  personalityPresets: z.array(z.string().trim().min(1).max(40)).max(8),
  humorLevel: ratio,
  languages: z.array(language).min(1).max(8),
  respondToMentions: z.boolean(),
  respondToReplies: z.boolean(),
  joinRelevantConversations: z.boolean(),
  initiateConversations: z.boolean(),
  initiationIntervalMs: z.coerce.number().int().min(60_000).max(30 * 24 * 60 * 60 * 1_000),
  maxDailyInitiations: z.coerce.number().int().min(0).max(100),
  memoryEnabled: z.boolean(),
  webSearchEnabled: z.boolean(),
  mediaSkillsEnabled: z.boolean(),
  voiceSkillsEnabled: z.boolean(),
});

export type PersonalityPatch = z.infer<typeof personalityPatchSchema>;

export const PERSONALITY_PRESETS: Record<string, Partial<Personality>> = {
  Friendly: { tone: "warm", humorLevel: 0.35, talkativeness: 0.55 },
  Funny: { tone: "playful", humorLevel: 0.8, emojiFrequency: 0.55 },
  Confident: { confidence: 0.9, formality: 0.2 },
  Calm: { tone: "warm", humorLevel: 0.2, talkativeness: 0.3 },
  Playful: { tone: "playful", humorLevel: 0.7, emojiFrequency: 0.45 },
  Sarcastic: { tone: "playful", humorLevel: 0.75 },
  Helpful: { tone: "warm", talkativeness: 0.55, responseLength: "medium" },
  Chill: { tone: "casual", talkativeness: 0.35, responseLength: "short" },
  Serious: { tone: "formal", humorLevel: 0.05, formality: 0.8 },
  Talkative: { talkativeness: 0.8, initiative: 0.55 },
  Quiet: { talkativeness: 0.15, initiative: 0.05 },
  Professional: { tone: "formal", formality: 0.9, humorLevel: 0.1, languageMix: "english" },
  Street: { tone: "playful", languageMix: "mixed", humorLevel: 0.65 },
  "Nigerian Pidgin": { languageMix: "pidgin", languages: ["english", "nigerian pidgin"] },
};

export function defaultPersonality(displayName: string): Personality {
  return {
    displayName,
    genderPresentation: "neutral",
    tone: "casual",
    talkativeness: 0.35,
    confidence: 0.7,
    formality: 0.25,
    languageMix: "english",
    emojiFrequency: 0.15,
    initiative: 0.3,
    responseLength: "short",
    personalityPresets: [],
    humorLevel: 0.45,
    languages: ["english"],
    respondToMentions: true,
    respondToReplies: true,
    joinRelevantConversations: true,
    initiateConversations: false,
    initiationIntervalMs: 6 * 60 * 60 * 1_000,
    maxDailyInitiations: 2,
    memoryEnabled: true,
    webSearchEnabled: true,
    mediaSkillsEnabled: true,
    voiceSkillsEnabled: true,
  };
}

export function resolvePersonality(base: Personality, override?: Partial<Personality>): Personality {
  const defaults = defaultPersonality(override?.displayName ?? base.displayName ?? "Kola");
  const baseValue = { ...defaults, ...base };
  const presetNames = override?.personalityPresets ?? baseValue.personalityPresets;
  const presetValues = presetNames.reduce<Partial<Personality>>((result, name) => ({ ...result, ...(PERSONALITY_PRESETS[name] ?? {}) }), {});
  const resolved = {
    ...baseValue,
    ...presetValues,
    ...(override ?? {}),
    personalityPresets: [...new Set(presetNames)],
  };
  return {
    ...resolved,
    languages: resolved.languageMix === "english"
      ? ["english"]
      : resolved.languageMix === "pidgin"
        ? ["nigerian pidgin", "english"]
        : [...new Set(override?.languages ?? baseValue.languages)],
  };
}

export function migrateLegacyPersonality(personality?: Partial<Personality>): Partial<Personality> | undefined {
  if (!personality) return undefined;
  const defaultMixedLanguages = personality.languages?.map((item) => item.toLowerCase()).sort().join(",") === "english,nigerian pidgin";
  if (personality.languageMix === "mixed" && (personality.languages === undefined || (defaultMixedLanguages && (personality.personalityPresets?.length ?? 0) === 0))) {
    return { ...personality, languageMix: "english", languages: ["english"] };
  }
  return personality;
}

export function applyLanguagePreference(personality: Personality, preference: LanguagePreference): Personality {
  return {
    ...personality,
    languageMix: preference,
    languages: preference === "english"
      ? ["english"]
      : preference === "pidgin"
        ? ["nigerian pidgin", "english"]
        : ["english", "nigerian pidgin"],
  };
}

export function parseLanguageCommand(text: string): LanguagePreference | "help" | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  const match = normalized.match(/^(?:\/)?(?:set\s+)?(?:my\s+)?(?:language|lang)(?:\s+preference)?(?:\s+(?:is|to|as))?\s*(?::|=)?\s*(english|pidgin|mixed)?$/);
  if (!match) return undefined;
  return (match[1] as LanguagePreference | undefined) ?? "help";
}

export interface ResponsePolicy {
  shouldReply: boolean;
  replyToMessage: boolean;
  shouldMention: boolean;
  shouldReact: boolean;
  shouldSearch: boolean;
  shouldUseMemory: boolean;
  shouldSendMedia: boolean;
  shouldSendAudio: boolean;
  tone: Personality["tone"];
  language: string;
  humorLevel: number;
  emojiLevel: number;
  responseLength: Personality["responseLength"];
}

export function responsePolicy(personality: Personality, message: CanonicalMessage, signals: ParticipationSignals, relevant: boolean): ResponsePolicy {
  const directlyAddressed = signals.directed;
  const shouldReply = !message.isGroup || (
    relevant &&
    (directlyAddressed || personality.joinRelevantConversations) &&
    (!signals.directMention || personality.respondToMentions) &&
    (!signals.directReply || personality.respondToReplies)
  );
  const language = personality.languageMix === "pidgin"
    ? "Nigerian Pidgin"
    : personality.languageMix === "mixed"
      ? "the incoming language, mixing English and Nigerian Pidgin only when natural"
      : "English";
  return {
    shouldReply,
    replyToMessage: shouldReply && (directlyAddressed || message.isGroup),
    shouldMention: shouldReply && signals.directMention,
    shouldReact: shouldReply && personality.humorLevel >= 0.65 && !directlyAddressed,
    shouldSearch: shouldReply && personality.webSearchEnabled,
    shouldUseMemory: shouldReply && personality.memoryEnabled,
    shouldSendMedia: shouldReply && personality.mediaSkillsEnabled,
    shouldSendAudio: shouldReply && personality.voiceSkillsEnabled,
    tone: personality.tone,
    language,
    humorLevel: personality.humorLevel,
    emojiLevel: personality.emojiFrequency,
    responseLength: personality.responseLength,
  };
}

export function personaInstructions(personality: Personality): string[] {
  const languageRule = personality.languageMix === "english"
    ? "Output language: standard English only. Do not use Nigerian Pidgin, Yoruba, Igbo, or Hausa unless the user explicitly asks for it."
    : personality.languageMix === "pidgin"
      ? "Output language: Nigerian Pidgin, unless the user explicitly asks for another language."
      : "Output language: follow the user's language naturally, using Nigerian Pidgin only when it is clearly appropriate.";
  return [
    `Persona name: ${personality.displayName}. Presentation: ${personality.genderPresentation}.`,
    `Tone: ${personality.tone}; humor level: ${Math.round(personality.humorLevel * 100)}%; response length: ${personality.responseLength}.`,
    `Language preference: ${personality.languages.join(", ")}. Do not force slang or switch languages without a clear reason.`,
    languageRule,
    `Emoji level: ${Math.round(personality.emojiFrequency * 100)}%; talkativeness: ${Math.round(personality.talkativeness * 100)}%.`,
    `Approved capabilities: memory=${personality.memoryEnabled}, web search=${personality.webSearchEnabled}, media=${personality.mediaSkillsEnabled}, voice=${personality.voiceSkillsEnabled}.`,
    "During normal conversation speak as a group participant in first person: I, me, my, we, or us. Do not describe yourself as the AI, bot, or assistant unless discussing the system technically.",
    "Keep personality separate from accuracy, privacy, authorization, and security. Never invent facts or claim to have performed an unavailable action.",
    ...(personality.customDescription ? [`Custom persona guidance: ${personality.customDescription}`] : []),
  ];
}

export function previewPersonality(message: string, personality: Personality): string {
  const normalized = message.trim();
  const pidgin = personality.languageMix === "pidgin" || (personality.languageMix === "mixed" && personality.languages.some((item) => item.toLowerCase().includes("pidgin")));
  const asksWhat = /\bwhat\s+(?:are|you)\b|\bdoing\b/i.test(normalized);
  let reply = pidgin
    ? asksWhat ? "Nothing serious, I just dey here dey watch una." : "I dey here na, tell me wetin you need."
    : asksWhat ? "Nothing dramatic, I am here with you." : "I hear you. I am here to help.";
  if (personality.tone === "formal") reply = asksWhat ? "I am available and ready to help." : "I can help with that.";
  if (personality.tone === "playful" || personality.humorLevel >= 0.65) reply += pidgin ? " Una no go let me rest 😂" : " You people are keeping me busy 😂";
  else if (personality.emojiFrequency >= 0.6) reply += " 🙂";
  return reply.slice(0, 2_000);
}
