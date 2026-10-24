import { excuseLimiter, pickFallbackLine, pickHoldUpLine } from "./fallback-lines.js";
import { z } from "zod";
import type { AppConfig, CanonicalMessage, DecisionPlan, GroupRecord, Personality } from "./types.js";
import type { ContextSnapshot } from "./memory.js";
import type { ProviderRouter, ProviderInput } from "./providers.js";
import { DEFAULT_PARTICIPATION, naturalDelay, participationSignals, shouldBypassCooldown, type ActionPriority } from "./participation.js";
import { responsePolicy } from "./persona.js";
import { extractHttpsUrls } from "./network.js";
import { isMusicRequestText } from "./music.js";

const decisionSchema = z.object({
  decision: z.enum(["IGNORE", "REACT", "REPLY", "REPLY_QUOTED", "MENTION_REPLY", "SEND_IMAGE", "SEND_STICKER", "SEND_AUDIO"]),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().min(1).max(500),
  targetMessageId: z.string().min(1).max(200).optional(),
  reaction: z.string().min(1).max(8).optional(),
  text: z.preprocess((value) => typeof value === "string" ? value.trim().slice(0, 2_000) : value, z.string().max(2000).optional()),
  mediaQuery: z.string().trim().min(1).max(300).optional(),
  mediaUrl: z.string().url().optional(),
  mediaMimeType: z.string().max(100).optional(),
  delayMs: z.coerce.number().int().min(0).max(60_000).default(0),
  needsWeb: z.boolean().default(false),
  needsMedia: z.boolean().default(false),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  bypassCooldown: z.boolean().optional(),
  mentionAll: z.boolean().optional(),
  responseStyle: z.preprocess((value) => normalizeResponseStyle(value), z.enum(["short_casual", "helpful", "playful", "uncertain"]).default("short_casual")),
});

export function parseDecisionPlan(input: string | unknown): DecisionPlan {
  let value: unknown = input;
  if (typeof input === "string") {
    const cleaned = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    value = parseJsonObject(cleaned);
  }
  const parsed = decisionSchema.parse(value);
  return {
    decision: parsed.decision,
    confidence: parsed.confidence,
    reason: parsed.reason,
    ...(parsed.targetMessageId ? { targetMessageId: parsed.targetMessageId } : {}),
    ...(parsed.reaction ? { reaction: parsed.reaction } : {}),
    ...(parsed.text ? { text: parsed.text } : {}),
    ...(parsed.mediaQuery ? { mediaQuery: parsed.mediaQuery } : {}),
    ...(parsed.mediaUrl ? { mediaUrl: parsed.mediaUrl } : {}),
    ...(parsed.mediaMimeType ? { mediaMimeType: parsed.mediaMimeType } : {}),
    delayMs: parsed.delayMs,
    needsWeb: parsed.needsWeb,
    needsMedia: parsed.needsMedia,
    ...(parsed.priority ? { priority: parsed.priority } : {}),
    ...(parsed.bypassCooldown !== undefined ? { bypassCooldown: parsed.bypassCooldown } : {}),
    ...(parsed.mentionAll !== undefined ? { mentionAll: parsed.mentionAll } : {}),
    responseStyle: parsed.responseStyle,
  };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end <= start) throw error;
    return JSON.parse(value.slice(start, end + 1));
  }
}

export interface LocalRelevance {
  relevant: boolean;
  reason: string;
  directed: boolean;
  directReply?: boolean;
  directMention?: boolean;
  mentionAll?: boolean;
  priority?: ActionPriority;
}

export function localRelevance(message: CanonicalMessage, botName: string, botJid?: string, talkativeness = 0.35, botJids: string[] = [], alwaysReplyToAllowedDm = false, personality?: Pick<Personality, "respondToMentions" | "respondToReplies" | "joinRelevantConversations">, recentBotActions: ContextSnapshot["recentActions"] = []): LocalRelevance {
  const text = message.text ?? "";
  if (!message.isGroup && alwaysReplyToAllowedDm) return { relevant: true, reason: "allowlisted_dm", directed: true };
  const signals = participationSignals(message, botName, botJid, botJids);
  if (signals.directMention && !signals.directReply && personality?.respondToMentions === false) return { relevant: false, reason: "mentions_disabled", ...signals };
  if (signals.directReply && personality?.respondToReplies === false) return { relevant: false, reason: "replies_disabled", ...signals };
  if (isMediaRequestText(text)) return { relevant: true, reason: "media_request", ...signals, directed: true, priority: "HIGH" };
  if (isStickerRequestText(text)) return { relevant: true, reason: "sticker_request", ...signals, directed: true, priority: "HIGH" };
  if (isLinkAnalysisRequestText(text)) return { relevant: true, reason: "link_analysis_request", ...signals, directed: true, priority: "HIGH" };
  if (isMusicRequestText(text)) return { relevant: true, reason: "music_request", ...signals, directed: true, priority: "NORMAL" };
  if (signals.directed) return { relevant: true, reason: "directed_to_bot", ...signals };
  if (message.quotedMessageId) return { relevant: true, reason: "reply_or_quote", ...signals };
  if (/[?؟]\s*$/.test(text) || /\b(can|could|should|would|what|when|where|why|how|is|are|do|does)\b/i.test(text)) {
    return { relevant: true, reason: "explicit_question", ...signals };
  }
  if (/\b(is this true|latest|breaking|current price|today)\b/i.test(text)) {
    return { relevant: true, reason: "current_information", ...signals };
  }
  if (message.type === "audio") return { relevant: true, reason: "audio_message", ...signals };
  if (message.isGroup && ["image", "sticker"].includes(message.type) && !text.trim()) return { relevant: false, reason: "standalone_media", ...signals };
  if (message.isGroup && text.trim()) return { relevant: true, reason: "group_message_candidate", ...signals };
  if (!message.isGroup && text.trim()) return { relevant: true, reason: "conversation_message", ...signals };
  return { relevant: false, reason: text.trim() ? "unaddressed_group_message" : "empty_message", ...signals };
}

export class DecisionEngine {
  constructor(private readonly router: ProviderRouter) {}

  async decide(
    message: CanonicalMessage,
    group: GroupRecord,
    context: ContextSnapshot,
    config: Pick<AppConfig, "botName" | "botJid"> & Partial<Pick<AppConfig, "botJids" | "participation">> & { alwaysReplyToAllowedDm?: boolean },
  ): Promise<{ plan: DecisionPlan; local: LocalRelevance; usedAi: boolean }> {
    const local = localRelevance(message, config.botName, config.botJid, context.personality.talkativeness, config.botJids ?? [], config.alwaysReplyToAllowedDm ?? false, context.personality, context.recentActions);
    if (!local.relevant) {
      return { plan: ignorePlan("Local relevance gate chose silence."), local, usedAi: false };
    }
    const policy = responsePolicy(context.personality, message, {
      directed: local.directed,
      directReply: local.directReply === true,
      directMention: local.directMention === true,
      mentionAll: local.mentionAll === true,
      priority: local.priority ?? "NORMAL",
    }, local.relevant);
    if (!policy.shouldReply) return { plan: ignorePlan("Persona response policy chose silence."), local, usedAi: false };
    if (message.transcriptConfidence !== undefined && message.transcriptConfidence < 0.45) {
      const voice = message.type === "audio";
      return {
        plan: {
          decision: "REPLY",
          confidence: 1,
          reason: "low_transcript_confidence",
          text: pickFallbackLine(voice ? "voice" : "generic", message.senderId),
          delayMs: 0,
          needsWeb: false,
          needsMedia: false,
          responseStyle: "short_casual",
        },
        local,
        usedAi: false,
      };
    }

    const input: ProviderInput = {
      messageId: message.id,
      senderId: message.senderId,
      messageText: message.text ?? message.media?.caption ?? "",
      messageType: message.type,
      directed: local.directed,
      ...(message.quotedMessageId ? { quotedMessageId: message.quotedMessageId } : {}),
      ...(message.quotedSenderId ? { quotedSenderId: message.quotedSenderId } : {}),
      ...(message.mentionedIds.length ? { mentionedIds: message.mentionedIds } : {}),
      ...(message.transcriptConfidence !== undefined ? { transcriptConfidence: message.transcriptConfidence } : {}),
      ...(message.transcriptLanguage ? { transcriptLanguage: message.transcriptLanguage } : {}),
      ...(message.senderName ? { senderName: message.senderName } : {}),
      context,
    };
    // One more walk through the pool before giving up on the AI for this message.
    const plan = (await this.router.classify(input, group.id)) ?? (await this.router.classify(input, group.id));
    if (plan) excuseLimiter.noteRealReply(message.senderId);
    const safePlan = plan && plan.targetMessageId && plan.targetMessageId !== message.id
      ? { ...plan, targetMessageId: message.id }
      : plan;
    const mediaRequest = isMediaRequestText(message.text ?? "");
    const stickerRequest = isStickerRequestText(message.text ?? "");
    const responsePlan = safePlan && local.directed && safePlan.decision === "IGNORE" && !mediaRequest && !stickerRequest
      ? { ...safePlan, decision: "REPLY" as const, reason: "Directly addressed; generate a safe response." }
      : safePlan;
    if (!responsePlan) {
      // Allowlisted DMs always get a reply: classification decides how, never whether.
      const allowlistedFallback = !message.isGroup && local.reason === "allowlisted_dm";
      return {
        plan: mediaRequest ? mediaRequestPlan() : stickerRequest ? stickerRequestPlan() : allowlistedFallback ? dmFallbackPlan(message) : ignorePlan("No healthy AI provider is configured; choosing silence."),
        local,
        usedAi: false,
      };
    }
    let safeResponsePlan = mediaRequest && responsePlan.decision === "IGNORE" ? mediaRequestPlan() : stickerRequest && responsePlan.decision === "IGNORE" ? stickerRequestPlan() : responsePlan;
    if (["SEND_IMAGE", "SEND_STICKER"].includes(safeResponsePlan.decision) && !context.personality.mediaSkillsEnabled) {
      safeResponsePlan = { ...safeResponsePlan, decision: "REPLY", reason: "media_skills_disabled", needsMedia: false, text: "I can't send media in this group right now." };
    }
    if (safeResponsePlan.decision === "SEND_AUDIO" && !context.personality.voiceSkillsEnabled) {
      safeResponsePlan = { ...safeResponsePlan, decision: "REPLY", reason: "voice_skills_disabled", needsMedia: false, text: "I can't send a voice note right now, so I'll reply in text." };
    }
    const participation = config.participation ?? { ...DEFAULT_PARTICIPATION };
    const directReply = local.directReply === true;
    const directMention = local.directMention === true;
    const bypassCooldown = shouldBypassCooldown({ directReply, directMention }, participation);
    const requestedDelayMs = directReply
      ? Math.max(safeResponsePlan.delayMs, naturalDelay(participation.directReplyDelayMinMs, participation.directReplyDelayMaxMs))
      : directMention
        ? Math.max(safeResponsePlan.delayMs, naturalDelay(participation.directMentionDelayMinMs, participation.directMentionDelayMaxMs))
        : safeResponsePlan.delayMs;
    const delayMs = Math.min(message.isGroup ? 3_000 : 5_000, requestedDelayMs);
    return {
      plan: {
        ...safeResponsePlan,
        delayMs,
        needsMedia: safeResponsePlan.needsMedia || ["SEND_IMAGE", "SEND_STICKER"].includes(safeResponsePlan.decision),
        priority: safeResponsePlan.priority ?? local.priority ?? (local.directed ? "HIGH" : "NORMAL"),
        bypassCooldown: safeResponsePlan.bypassCooldown ?? bypassCooldown,
        mentionAll: safeResponsePlan.mentionAll ?? local.mentionAll ?? false,
      },
      local,
      usedAi: true,
    };
  }
}

export function isMediaRequestText(text: string): boolean {
  return /\b(?:send|show|find|get|search|look\s+up)\b[\s\S]{0,100}\b(?:picture|image|photo|meme|gif)\b/i.test(text)
    || /\b(?:picture|image|photo|meme|gif)\s+(?:of|about)\b/i.test(text);
}

export function isStickerRequestText(text: string): boolean {
  return /\b(?:send|show|find|get|search|look\s+up)\b[\s\S]{0,100}\bsticker\b/i.test(text)
    || /\bsticker\b[\s\S]{0,100}\b(?:of|about|for)\b/i.test(text);
}

export function isLinkAnalysisRequestText(text: string): boolean {
  if (!extractHttpsUrls(text).length) return false;
  return /\b(?:analy[sz]e|summari[sz]e|review|explain|inspect|check|look\s+at|what\s+do\s+you\s+think|brand|company|website|freelance|client|job|legit|scam)\b/i.test(text);
}

function mediaRequestPlan(): DecisionPlan {
  return {
    decision: "SEND_IMAGE",
    confidence: 1,
    reason: "local_media_request",
    delayMs: 0,
    needsWeb: false,
    needsMedia: true,
    responseStyle: "short_casual",
  };
}

function stickerRequestPlan(): DecisionPlan {
  return {
    decision: "SEND_STICKER",
    confidence: 1,
    reason: "local_sticker_request",
    delayMs: 0,
    needsWeb: false,
    needsMedia: true,
    responseStyle: "short_casual",
  };
}

export function ignorePlan(reason: string): DecisionPlan {
  return {
    decision: "IGNORE",
    confidence: 1,
    reason,
    delayMs: 0,
    needsWeb: false,
    needsMedia: false,
    responseStyle: "short_casual",
  };
}

function normalizeResponseStyle(value: unknown): unknown {
  if (typeof value !== "string") return "short_casual";
  const normalized = value.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (["short", "casual", "concise", "brief", "short_response", "concise_casual", "short_casual"].includes(normalized)) return "short_casual";
  if (["long", "detailed", "informative", "helpful"].includes(normalized)) return "helpful";
  if (["playful", "fun", "humorous"].includes(normalized)) return "playful";
  if (["uncertain", "unsure", "cautious"].includes(normalized)) return "uncertain";
  return "short_casual";
}

function isLowSignalGroupMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  if (/^[\p{Extended_Pictographic}\s!?.,😂🤣😭]+$/u.test(normalized)) return true;
  if (/^(?:o{2,}|h+a+h+a+|l+m+a+o+)\s*[!?.,😂🤣😭]*$/i.test(normalized)) return true;
  if (/^(?:good\s+(?:morning|afternoon|evening)|(?:hi|hello|hey))(?:[\s,]*(?:everyone|everybody|guys|y'all|all|folks))?\s*[.!?]*$/i.test(normalized)) return true;
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const lowSignalWords = new Set(["afternoon", "evening", "good", "hello", "hey", "hi", "lol", "lmao", "morning", "no", "ok", "okay", "omo", "please", "same", "sha", "thanks", "thank", "true", "wow", "yeah", "yes", "yo"]);
  return normalized.length <= 12 && words.length <= 2 && words.every((word) => lowSignalWords.has(word));
}

// AI walk failed on a normal text DM. Never a media-failure line here. At most one plain
// "hold up" per sender per hour and never more than 2 in a row; otherwise stay quiet.
function dmFallbackPlan(message: CanonicalMessage): DecisionPlan {
  if (!excuseLimiter.tryUse(message.senderId)) {
    return ignorePlan("AI unavailable; excuse rate-limited, choosing silence.");
  }
  return {
    decision: "REPLY",
    confidence: 1,
    reason: "allowlisted_dm_fallback",
    text: pickHoldUpLine(message.senderId),
    delayMs: 0,
    needsWeb: false,
    needsMedia: false,
    responseStyle: "short_casual",
  } as DecisionPlan;
}
