import { createHash } from "node:crypto";
import type { CanonicalMessage, GroupRecord, MemberRecord, MemoryRecord, Personality } from "./types.js";
import type { Store } from "./store.js";

export interface ContextSnapshot {
  group: Pick<GroupRecord, "id" | "subject" | "participantCount">;
  recentMessages: Array<{ sender: string; text: string; type: string; timestamp: number }>;
  member?: Pick<MemberRecord, "displayName" | "behaviorProfile" | "confidence">;
  memories: Array<{ type: string; value: Record<string, unknown>; confidence: number }>;
  personality: Personality;
}

export class MemoryService {
  constructor(private readonly store: Store) {}

  async observe(message: CanonicalMessage): Promise<void> {
    if (!message.groupId) return;
    const memberId = `${message.groupId}:${message.senderId}`;
    const previous = this.store.members(message.groupId).find((item) => item.id === memberId);
    const now = Date.now();
    const text = message.text ?? message.media?.caption ?? "";
    const previousCount = previous?.behaviorProfile.messageCount ?? 0;
    const count = previousCount + 1;
    const profile = {
      averageMessageLength: previous
        ? (previous.behaviorProfile.averageMessageLength * previousCount + text.length) / count
        : text.length,
      emojiFrequency: previous
        ? (previous.behaviorProfile.emojiFrequency * previousCount + emojiCount(text)) / count
        : emojiCount(text),
      ...(languageStyle(text) !== "unknown"
        ? { languageStyle: languageStyle(text) }
        : previous?.behaviorProfile.languageStyle
          ? { languageStyle: previous.behaviorProfile.languageStyle }
          : {}),
      messageCount: count,
      initiates: previous?.behaviorProfile.initiates ?? 0,
      replies: (previous?.behaviorProfile.replies ?? 0) + (message.quotedMessageId ? 1 : 0),
    } as MemberRecord["behaviorProfile"];
    const member: MemberRecord = {
      id: memberId,
      groupId: message.groupId,
      whatsappMemberId: message.senderId,
      ...(message.senderName ? { displayName: message.senderName } : previous?.displayName ? { displayName: previous.displayName } : {}),
      behaviorProfile: profile,
      confidence: {
        ...(previous?.confidence ?? {}),
        communicationStyle: Math.min(1, 0.2 + count / 25),
      },
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
    await this.store.upsertMember(member);

    const memory: MemoryRecord = {
      id: createHash("sha256").update(`${memberId}:communication-style`).digest("hex"),
      scopeType: "member",
      scopeId: memberId,
      memoryType: "communication-style",
      value: {
        languageStyle: profile.languageStyle ?? "unknown",
        averageMessageLength: Math.round(profile.averageMessageLength),
      },
      confidence: member.confidence.communicationStyle ?? 0,
      evidenceCount: count,
      createdAt: previous?.firstSeenAt ?? now,
      lastConfirmedAt: now,
    };
    await this.store.upsertMemory(memory);
  }

  context(group: GroupRecord, senderId: string, personality: Personality): ContextSnapshot {
    const memberId = `${group.id}:${senderId}`;
    const member = this.store.members(group.id).find((item) => item.id === memberId);
    const memories = this.store.memories(group.id).concat(this.store.memories(memberId));
    return {
      group: { id: group.id, subject: group.subject, participantCount: group.participantCount },
      recentMessages: this.store.recentMessages(group.id, 20).map((message) => ({
        sender: message.senderName ?? message.senderId,
        text: (message.text ?? `[${message.type}]`).slice(0, 500),
        type: message.type,
        timestamp: message.timestamp,
      })),
      ...(member
        ? { member: { displayName: member.displayName, behaviorProfile: member.behaviorProfile, confidence: member.confidence } }
        : {}),
      memories: memories
        .filter((item) => !item.expiresAt || item.expiresAt > Date.now())
        .slice(0, 20)
        .map((item) => ({ type: item.memoryType, value: item.value, confidence: item.confidence })),
      personality,
    };
  }
}

function emojiCount(text: string): number {
  return [...text.matchAll(/\p{Extended_Pictographic}/gu)].length;
}

function languageStyle(text: string): "english" | "pidgin" | "mixed" | "unknown" {
  if (!text.trim()) return "unknown";
  const pidginWords = (text.match(/\b(abi|abeg|dey|na|wetin|wahala|una|chop|oya|sha)\b/gi) ?? []).length;
  const words = text.trim().split(/\s+/).length;
  if (pidginWords === 0) return "english";
  if (pidginWords >= Math.max(1, Math.floor(words / 5))) return "pidgin";
  return "mixed";
}
