import { createHash } from "node:crypto";
import type { CanonicalMessage, GroupRecord, MemberRecord, MemoryRecord, MemoryRetriever, MemoryStatus, MemoryUpsertHook, Personality } from "./types.js";
import type { Store } from "./store.js";

export interface ContextSnapshot {
  group: Pick<GroupRecord, "id" | "subject" | "participantCount">;
  recentMessages: Array<{ sender: string; text: string; type: string; timestamp: number }>;
  recentActions?: Array<{ type: string; text: string; timestamp: number }>;
  member?: Pick<MemberRecord, "displayName" | "behaviorProfile" | "confidence">;
  memories: Array<{ id: string; type: string; value: Record<string, unknown>; confidence: number; importance: number; status: MemoryStatus }>;
  personality: Personality;
}

export class MemoryService {
  constructor(private readonly store: Store, private readonly onMemoryUpsert?: MemoryUpsertHook, private readonly retrieveMemory?: MemoryRetriever) {}

  async observe(message: CanonicalMessage): Promise<void> {
    const conversationId = message.groupId ?? message.chatId;
    const memberId = `${conversationId}:${message.senderId}`;
    const previous = this.store.members(conversationId).find((item) => item.id === memberId);
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
      groupId: conversationId,
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
      importance: 0.25,
      status: count >= 3 ? "ACTIVE" : "WEAK",
      evidenceCount: count,
      createdAt: previous?.firstSeenAt ?? now,
      lastConfirmedAt: now,
      updatedAt: now,
      sourceMessageId: message.id,
      sourceTimestamp: message.timestamp,
      sourceMemberId: message.senderId,
    };
    await this.saveMemory(memory);

    if (message.groupId) {
      const topic = extractTopic(text);
      if (topic) {
        const previousTopic = this.store.memories(message.groupId).find((item) => item.memoryType === "group-topic" && item.value.topic === topic);
        const topicCount = (previousTopic?.evidenceCount ?? 0) + 1;
        await this.saveMemory({
          id: createHash("sha256").update(`${message.groupId}:topic:${topic}`).digest("hex"),
          scopeType: "group",
          scopeId: message.groupId,
          memoryType: "group-topic",
          value: { topic, source: "observed_messages" },
          confidence: Math.min(1, 0.25 + topicCount / 20),
          importance: 0.4,
          status: topicCount >= 3 ? "ACTIVE" : "WEAK",
          evidenceCount: topicCount,
          createdAt: previousTopic?.createdAt ?? now,
          lastConfirmedAt: now,
          updatedAt: now,
          sourceMessageId: message.id,
          sourceTimestamp: message.timestamp,
          sourceMemberId: message.senderId,
          expiresAt: now + 30 * 24 * 60 * 60 * 1000,
        });
      }
    }

    const recent = conversationId.endsWith("@g.us")
      ? this.store.recentMessages(conversationId, 20)
      : this.store.recentChatMessages(conversationId, 20);
    if (recent.length >= 5 && recent.length % 5 === 0) {
      const summary = recent.slice(-8).map((item) => `${item.senderName ?? item.senderId}: ${(item.text ?? `[${item.type}]`).slice(0, 180)}`).join(" | ");
      const previousSummary = this.store.memories(conversationId).find((item) => item.memoryType === "conversation-summary");
      await this.saveMemory({
        id: createHash("sha256").update(`${conversationId}:conversation-summary`).digest("hex"),
        scopeType: message.groupId ? "group" : "relationship",
        scopeId: conversationId,
        memoryType: "conversation-summary",
        value: { summary: summary.slice(0, 1800), messageCount: recent.length },
        confidence: 0.65,
        importance: 0.5,
        status: "ACTIVE",
        evidenceCount: (previousSummary?.evidenceCount ?? 0) + 1,
        createdAt: previousSummary?.createdAt ?? now,
        lastConfirmedAt: now,
        updatedAt: now,
        sourceMessageId: message.id,
        sourceTimestamp: message.timestamp,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      });
    }
  }

  private async saveMemory(memory: MemoryRecord): Promise<void> {
    await this.store.upsertMemory(memory);
    await this.onMemoryUpsert?.(memory);
  }

  context(group: GroupRecord, senderId: string, personality: Personality, query = ""): ContextSnapshot {
    const memberId = `${group.id}:${senderId}`;
    const member = this.store.members(group.id).find((item) => item.id === memberId);
    const memories = this.relevantMemories(group.id, memberId, query);
    const recentActions = this.store.actions(100)
      .filter((action) => action.groupId === group.id && action.status === "SENT")
      .slice(0, 10)
      .map((action) => ({ type: action.actionType, text: typeof action.payload.text === "string" ? action.payload.text.slice(0, 500) : "", timestamp: action.executedAt ?? action.scheduledFor }));
    return {
      group: { id: group.id, subject: group.subject, participantCount: group.participantCount },
      recentMessages: (group.id.endsWith("@g.us") ? this.store.recentMessages(group.id, 20) : this.store.recentChatMessages(group.id, 20)).map((message) => ({
        sender: message.senderName ?? message.senderId,
        text: (message.text ?? `[${message.type}]`).slice(0, 500),
        type: message.type,
        timestamp: message.timestamp,
      })),
      ...(member
        ? { member: { displayName: member.displayName, behaviorProfile: member.behaviorProfile, confidence: member.confidence } }
        : {}),
      memories: memories.map((item) => ({ id: item.id, type: item.memoryType, value: item.value, confidence: item.confidence, importance: item.importance, status: item.status })),
      ...(recentActions.length ? { recentActions } : {}),
      personality,
    };
  }

  async contextWithSemantic(group: GroupRecord, senderId: string, personality: Personality, query = ""): Promise<ContextSnapshot> {
    const base = this.context(group, senderId, personality, query);
    if (!this.retrieveMemory || !query.trim()) return base;
    const memberId = `${group.id}:${senderId}`;
    const [groupHits, memberHits] = await Promise.all([
      this.retrieveMemory(query, group.id, 5),
      this.retrieveMemory(query, memberId, 5),
    ]);
    const existing = new Set(base.memories.map((memory) => memory.id));
    const stored = new Map(this.store.memories().map((memory) => [memory.id, memory]));
    const semantic = [
      ...groupHits.map((hit) => ({ hit, scopeId: group.id })),
      ...memberHits.map((hit) => ({ hit, scopeId: memberId })),
    ]
      .flatMap(({ hit, scopeId }) => {
        const memory = stored.get(hit.memory.id);
        return memory && memory.scopeId === scopeId ? [{ memory, score: hit.score }] : [];
      })
      .filter((hit) => hit.memory.status !== "ARCHIVED" && hit.memory.status !== "DELETED")
      .filter((hit) => !hit.memory.expiresAt || hit.memory.expiresAt > Date.now())
      .sort((left, right) => right.score - left.score)
      .filter((hit) => !existing.has(hit.memory.id))
      .slice(0, 5)
      .map((hit) => ({ id: hit.memory.id, type: hit.memory.memoryType, value: hit.memory.value, confidence: hit.memory.confidence, importance: hit.memory.importance, status: hit.memory.status }));
    return semantic.length ? { ...base, memories: [...base.memories.slice(0, Math.max(0, 20 - semantic.length)), ...semantic] } : base;
  }

  private relevantMemories(groupId: string, memberId: string, query: string): MemoryRecord[] {
    const queryWords = new Set(query.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []);
    return this.store.memories(groupId).concat(this.store.memories(memberId))
      .filter((item) => !item.expiresAt || item.expiresAt > Date.now())
      .filter((item) => item.status !== "ARCHIVED" && item.status !== "DELETED")
      .sort((left, right) => memoryScore(right, queryWords) - memoryScore(left, queryWords))
      .slice(0, 20);
  }
}

function memoryScore(memory: MemoryRecord, queryWords: Set<string>): number {
  const searchable = JSON.stringify(memory.value).toLowerCase();
  const matches = [...queryWords].filter((word) => searchable.includes(word)).length;
  const semanticRelevance = queryWords.size ? matches / queryWords.size : 0.5;
  const ageDays = Math.max(0, (Date.now() - memory.lastConfirmedAt) / (24 * 60 * 60 * 1000));
  const recency = Math.exp(-ageDays / 30);
  const statusWeight = memory.status === "STALE" ? 0.5 : memory.status === "WEAK" ? 0.75 : 1;
  return (semanticRelevance * 0.5 + memory.confidence * 0.2 + memory.importance * 0.2 + recency * 0.1) * statusWeight;
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

function extractTopic(text: string): string | undefined {
  const stopWords = new Set(["about", "after", "again", "because", "before", "being", "could", "from", "have", "just", "make", "that", "their", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your"]);
  return text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.find((word) => !stopWords.has(word) && !/^(https?|www|message|please)$/.test(word));
}
