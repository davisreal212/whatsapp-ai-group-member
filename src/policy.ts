import type { AppConfig, CanonicalMessage, GroupRecord } from "./types.js";

export type PolicyReason =
  | "AI_PROCESSING_PAUSED"
  | "DIRECT_MESSAGE"
  | "NOT_A_GROUP"
  | "STATUS_MESSAGE"
  | "UNAUTHORIZED_GROUP"
  | "DISABLED_GROUP"
  | "GROUP_PAUSED"
  | "BOT_OWN_MESSAGE"
  | "UNSUPPORTED_MESSAGE"
  | "ALLOWED";

export interface InboundPolicyDecision {
  allowed: boolean;
  reason: PolicyReason;
}

const supportedTypes = new Set(["text", "image", "video", "audio", "document", "sticker", "reaction"]);

export function evaluateInboundPolicy(
  message: CanonicalMessage,
  group: GroupRecord | undefined,
  config: Pick<AppConfig, "groupOnlyMode" | "aiProcessingPaused">,
): InboundPolicyDecision {
  if (config.aiProcessingPaused) return { allowed: false, reason: "AI_PROCESSING_PAUSED" };
  if (message.isStatus) return { allowed: false, reason: "STATUS_MESSAGE" };
  if (!message.isGroup) {
    return { allowed: false, reason: config.groupOnlyMode ? "DIRECT_MESSAGE" : "NOT_A_GROUP" };
  }
  if (!group) return { allowed: false, reason: "UNAUTHORIZED_GROUP" };
  if (!group.enabled) return { allowed: false, reason: "DISABLED_GROUP" };
  if (group.aiPaused) return { allowed: false, reason: "GROUP_PAUSED" };
  if (message.isFromBot) return { allowed: false, reason: "BOT_OWN_MESSAGE" };
  if (!supportedTypes.has(message.type)) return { allowed: false, reason: "UNSUPPORTED_MESSAGE" };
  return { allowed: true, reason: "ALLOWED" };
}

export function isCurrentInformationQuestion(text: string): boolean {
  return /\b(now|today|tonight|latest|current|breaking|recent|this week|price|listing|is this true|official)\b/i.test(text);
}
