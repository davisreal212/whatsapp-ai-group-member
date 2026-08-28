import { z } from "zod";
import type { AppConfig, CanonicalMessage, DecisionPlan, GroupRecord } from "./types.js";
import type { ContextSnapshot } from "./memory.js";
import type { ProviderRouter, ProviderInput } from "./providers.js";

const decisionSchema = z.object({
  decision: z.enum(["IGNORE", "REACT", "REPLY", "REPLY_QUOTED", "MENTION_REPLY", "SEND_IMAGE", "SEND_AUDIO"]),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().min(1).max(500),
  targetMessageId: z.string().min(1).max(200).optional(),
  reaction: z.string().min(1).max(8).optional(),
  text: z.string().max(2000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaMimeType: z.string().max(100).optional(),
  delayMs: z.coerce.number().int().min(0).max(60_000).default(0),
  needsWeb: z.boolean().default(false),
  needsMedia: z.boolean().default(false),
  responseStyle: z.enum(["short_casual", "helpful", "playful", "uncertain"]).default("short_casual"),
});

export function parseDecisionPlan(input: string | unknown): DecisionPlan {
  let value: unknown = input;
  if (typeof input === "string") {
    const cleaned = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    value = JSON.parse(cleaned);
  }
  const parsed = decisionSchema.parse(value);
  return {
    decision: parsed.decision,
    confidence: parsed.confidence,
    reason: parsed.reason,
    ...(parsed.targetMessageId ? { targetMessageId: parsed.targetMessageId } : {}),
    ...(parsed.reaction ? { reaction: parsed.reaction } : {}),
    ...(parsed.text ? { text: parsed.text } : {}),
    ...(parsed.mediaUrl ? { mediaUrl: parsed.mediaUrl } : {}),
    ...(parsed.mediaMimeType ? { mediaMimeType: parsed.mediaMimeType } : {}),
    delayMs: parsed.delayMs,
    needsWeb: parsed.needsWeb,
    needsMedia: parsed.needsMedia,
    responseStyle: parsed.responseStyle,
  };
}

export interface LocalRelevance {
  relevant: boolean;
  reason: string;
  directed: boolean;
}

export function localRelevance(message: CanonicalMessage, botName: string, botJid?: string, talkativeness = 0.35): LocalRelevance {
  const text = message.text ?? "";
  const named = new RegExp(`(?:^|\\s)@${escapeRegExp(botName)}(?:\\b|$)`, "i").test(text);
  const directed = Boolean(
    message.quotedSenderId === botJid
      || (botJid && message.mentionedIds.includes(botJid))
      || named,
  );
  if (directed) return { relevant: true, reason: "directed_to_bot", directed: true };
  if (message.quotedMessageId) return { relevant: true, reason: "reply_or_quote", directed: false };
  if (/[?؟]\s*$/.test(text) || /\b(can|could|should|would|what|when|where|why|how|is|are|do|does)\b/i.test(text)) {
    return { relevant: true, reason: "explicit_question", directed: false };
  }
  if (/\b(is this true|latest|breaking|current price|today)\b/i.test(text)) {
    return { relevant: true, reason: "current_information", directed: false };
  }
  if (talkativeness >= 0.85 && text.trim().length >= 10) {
    return { relevant: true, reason: "high_talkativeness", directed: false };
  }
  return { relevant: false, reason: "no_local_relevance_signal", directed: false };
}

export class DecisionEngine {
  constructor(private readonly router: ProviderRouter) {}

  async decide(
    message: CanonicalMessage,
    group: GroupRecord,
    context: ContextSnapshot,
    config: Pick<AppConfig, "botName" | "botJid">,
  ): Promise<{ plan: DecisionPlan; local: LocalRelevance; usedAi: boolean }> {
    const local = localRelevance(message, config.botName, config.botJid, context.personality.talkativeness);
    if (!local.relevant) {
      return { plan: ignorePlan("Local relevance gate chose silence."), local, usedAi: false };
    }

    const input: ProviderInput = {
      messageText: message.text ?? message.media?.caption ?? "",
      messageType: message.type,
      ...(message.senderName ? { senderName: message.senderName } : {}),
      context,
    };
    const plan = await this.router.classify(input, group.id);
    return { plan: plan ?? ignorePlan("No healthy AI provider is configured; choosing silence."), local, usedAi: Boolean(plan) };
  }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
