import type { CanonicalMessage, GroupRecord, ParticipationSettings } from "./types.js";
import type { Store } from "./store.js";
import { sameWhatsAppIdentity } from "./identity.js";

export type ActivityLevel = "LOW" | "NORMAL" | "HIGH" | "EXTREME";
export type ActionPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export const DEFAULT_PARTICIPATION: ParticipationSettings = {
  groupCooldownMs: 15_000,
  directReplyBypass: true,
  directMentionBypass: true,
  directReplyDelayMinMs: 1_000,
  directReplyDelayMaxMs: 3_000,
  directMentionDelayMinMs: 1_000,
  directMentionDelayMaxMs: 3_000,
  adaptiveActivity: true,
  groupMentionAllCooldownMs: 1_800_000,
};

export interface ParticipationSignals {
  directed: boolean;
  directReply: boolean;
  directMention: boolean;
  mentionAll: boolean;
  priority: ActionPriority;
}

export interface GroupActivityState {
  groupJid: string;
  lastAIResponseAt?: number;
  cooldownUntil?: number;
  lastMentionAllAt?: number;
  messagesLast10Seconds: number;
  messagesLast30Seconds: number;
  messagesLast5Minutes: number;
  activityLevel: ActivityLevel;
}

export function resolveParticipation(base: ParticipationSettings, override?: Partial<ParticipationSettings>): ParticipationSettings {
  return { ...base, ...(override ?? {}) };
}

export function participationSignals(message: CanonicalMessage, botName: string, botJid?: string, botJids: string[] = []): ParticipationSignals {
  const text = message.text ?? "";
  const named = botName.trim().length > 0 && new RegExp(`(?:^|[^\\p{L}\\p{N}_])@?${escapeRegExp(botName.trim())}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(text);
  const identities = [botJid, ...botJids].filter((value): value is string => Boolean(value));
  const mentionedBot = message.mentionedIds.some((mentionedId) => identities.some((identity) => sameWhatsAppIdentity(mentionedId, identity)));
  const directReply = Boolean(message.quotedSenderId && identities.some((identity) => sameWhatsAppIdentity(message.quotedSenderId as string, identity)));
  const directMention = mentionedBot || named;
  const directed = directReply || directMention;
  const mentionAll = isMentionAll(text);
  const urgent = /\b(urgent|emergency|asap|immediately|right now)\b/i.test(text);
  const lowSignal = text.trim().length <= 12 || /^[\p{Extended_Pictographic}\s!?.,😂🤣😭]+$/u.test(text.trim());
  const priority: ActionPriority = urgent && directed ? "CRITICAL" : directed || mentionAll ? "HIGH" : lowSignal ? "LOW" : "NORMAL";
  return { directed, directReply, directMention, mentionAll, priority };
}

export function isMentionAll(text: string): boolean {
  return /(^|\s)@(all|everyone|here|todos|todas|tous)\b/i.test(text) || /\b(mention everyone|mention all)\b/i.test(text);
}

export function shouldBypassCooldown(signals: Pick<ParticipationSignals, "directReply" | "directMention">, settings: ParticipationSettings): boolean {
  return (signals.directReply && settings.directReplyBypass) || (signals.directMention && settings.directMentionBypass);
}

export function groupActivityState(store: Store, groupJid: string, settings: ParticipationSettings, now = Date.now()): GroupActivityState {
  const tenSecondsAgo = now - 10_000;
  const thirtySecondsAgo = now - 30_000;
  const fiveMinutesAgo = now - 300_000;
  const messages = store.recentMessages(groupJid, 500);
  const messagesLast10Seconds = messages.filter((message) => message.timestamp >= tenSecondsAgo).length;
  const messagesLast30Seconds = messages.filter((message) => message.timestamp >= thirtySecondsAgo).length;
  const messagesLast5Minutes = messages.filter((message) => message.timestamp >= fiveMinutesAgo).length;
  // Pending actions reserve the next response slot, preventing two workers from
  // both passing the cooldown check before either send is marked SENT.
  const actions = store.actions(2_000).filter((action) => action.groupId === groupJid && ["SENT", "PENDING"].includes(action.status));
  const lastAIResponseAt = actions.reduce<number | undefined>((latest, action) => {
    const timestamp = action.executedAt ?? action.scheduledFor;
    return latest === undefined || timestamp > latest ? timestamp : latest;
  }, undefined);
  const lastMentionAllAt = actions.reduce<number | undefined>((latest, action) => {
    if (action.payload.mentionAll !== true) return latest;
    const timestamp = action.executedAt ?? action.scheduledFor;
    return latest === undefined || timestamp > latest ? timestamp : latest;
  }, undefined);
  const activityLevel: ActivityLevel = messagesLast10Seconds >= 20 || messagesLast30Seconds >= 30
    ? "EXTREME"
    : messagesLast10Seconds >= 10 || messagesLast30Seconds >= 20
      ? "HIGH"
      : messagesLast30Seconds >= 2 || messagesLast5Minutes >= 10
        ? "NORMAL"
        : "LOW";
  return {
    groupJid,
    ...(lastAIResponseAt !== undefined ? { lastAIResponseAt, cooldownUntil: lastAIResponseAt + settings.groupCooldownMs } : {}),
    ...(lastMentionAllAt !== undefined ? { lastMentionAllAt } : {}),
    messagesLast10Seconds,
    messagesLast30Seconds,
    messagesLast5Minutes,
    activityLevel,
  };
}

export function naturalDelay(minMs: number, maxMs: number): number {
  const min = Math.max(0, Math.min(minMs, maxMs));
  const max = Math.max(min, maxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function groupParticipation(group: GroupRecord | undefined, base: ParticipationSettings): ParticipationSettings {
  return resolveParticipation(base, group?.participationOverride);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
