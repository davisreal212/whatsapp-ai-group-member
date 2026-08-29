import type { AppConfig, CanonicalMessage, GroupRecord } from "./types.js";
import { matchesWhatsAppIdentity } from "./identity.js";

export type PolicyReason =
  | "AI_PROCESSING_PAUSED"
  | "DIRECT_MESSAGE"
  | "DIRECT_MESSAGE_NOT_ALLOWLISTED"
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

export function evaluateInboundPolicy(
  message: CanonicalMessage,
  group: GroupRecord | undefined,
  config: Pick<AppConfig, "groupOnlyMode" | "directMessageAllowlist" | "aiProcessingPaused">,
): InboundPolicyDecision {
  if (config.aiProcessingPaused) return { allowed: false, reason: "AI_PROCESSING_PAUSED" };
  if (message.isStatus) return { allowed: false, reason: "STATUS_MESSAGE" };
  if (!message.isGroup) {
    if (config.groupOnlyMode) return { allowed: false, reason: "DIRECT_MESSAGE" };
    if (!isDirectMessageAllowed(message, config.directMessageAllowlist)) {
      return { allowed: false, reason: "DIRECT_MESSAGE_NOT_ALLOWLISTED" };
    }
  }
  if (message.isGroup) {
    if (!group) return { allowed: false, reason: "UNAUTHORIZED_GROUP" };
    if (!group.enabled) return { allowed: false, reason: "DISABLED_GROUP" };
    if (group.aiPaused) return { allowed: false, reason: "GROUP_PAUSED" };
  }
  if (message.isFromBot) return { allowed: false, reason: "BOT_OWN_MESSAGE" };
  return { allowed: true, reason: "ALLOWED" };
}

export function isDirectMessageAllowed(message: CanonicalMessage, allowlist: string[]): boolean {
  const candidates = [message.senderId, message.chatId, message.senderPhone].filter((value): value is string => Boolean(value));
  return candidates.some((candidate) => matchesWhatsAppIdentity(candidate, allowlist));
}

export function isCurrentInformationQuestion(text: string): boolean {
  return /\b(now|today|tonight|latest|current|breaking|recent|this week|price|listing|is this true|official)\b/i.test(text);
}

export function isQuietHours(start: number, end: number, now = new Date()): boolean {
  if (start < 0 || end < 0 || start === end) return false;
  const hour = now.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
