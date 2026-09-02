import { createHash } from "node:crypto";
import type { CanonicalMessage, GroupRecord, MemberRecord, MemoryDeleteHook, MemoryRecord, MemoryRetriever, MemoryStatus, MemoryUpsertHook, Personality, StoredMessage } from "./types.js";
import type { Store } from "./store.js";

export interface ContextSnapshot {
  group: Pick<GroupRecord, "id" | "subject" | "participantCount">;
  recentMessages: ContextMessage[];
  recentActions?: Array<{ type: string; text: string; timestamp: number }>;
  member?: Pick<MemberRecord, "displayName" | "behaviorProfile" | "confidence">;
  memories: Array<{ id: string; type: string; value: Record<string, unknown>; confidence: number; importance: number; status: MemoryStatus }>;
  personality: Personality;
  thread?: ThreadContext;
}

export interface ContextMessage {
  sender: string;
  text: string;
  type: string;
  timestamp: number;
}

export interface ThreadContext {
  state: "reply_chain" | "continuation" | "new_topic";
  confidence: number;
  anchorMessageId?: string;
  messages: ContextMessage[];
}

export interface MemoryServiceOptions {
  recentMessageLimit?: number;
  groupMemoryLimit?: number;
  memberMemoryLimit?: number;
  semanticMemoryLimit?: number;
  staleAfterDays?: number;
  archiveAfterDays?: number;
}

export class MemoryService {
  private readonly options: Required<MemoryServiceOptions>;

  constructor(
    private readonly store: Store,
    private readonly onMemoryUpsert?: MemoryUpsertHook,
    private readonly retrieveMemory?: MemoryRetriever,
    options: MemoryServiceOptions = {},
    private readonly onMemoryDelete?: MemoryDeleteHook,
  ) {
    this.options = {
      recentMessageLimit: clampInt(options.recentMessageLimit ?? 20, 1, 100),
      groupMemoryLimit: clampInt(options.groupMemoryLimit ?? 10, 0, 50),
      memberMemoryLimit: clampInt(options.memberMemoryLimit ?? 5, 0, 20),
      semanticMemoryLimit: clampInt(options.semanticMemoryLimit ?? 5, 0, 20),
      staleAfterDays: clampInt(options.staleAfterDays ?? 30, 1, 3650),
      archiveAfterDays: Math.max(clampInt(options.archiveAfterDays ?? 90, 2, 3650), (options.staleAfterDays ?? 30) + 1),
    };
  }

  async observe(message: CanonicalMessage): Promise<void> {
    if (message.groupId && this.store.group(message.groupId)?.learningEnabled === false) return;
    const conversationId = message.groupId ?? message.chatId;
    const memberId = `${conversationId}:${message.senderId}`;
    const previous = this.store.members(conversationId).find((item) => item.id === memberId);
    const now = Date.now();
    const text = message.text ?? message.media?.caption ?? "";
    const candidateText = memoryCandidateText(text);
    const previousCount = previous?.behaviorProfile.messageCount ?? 0;
    const count = previousCount + 1;
    const recentBefore = conversationId.endsWith("@g.us")
      ? this.store.recentMessages(conversationId, 20).filter((item) => item.id !== message.id)
      : this.store.recentChatMessages(conversationId, 20).filter((item) => item.id !== message.id);
    const initiates = !message.quotedMessageId && !recentBefore.some((item) => item.senderId !== message.senderId && now - item.timestamp <= 5 * 60_000);
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
      initiates: (previous?.behaviorProfile.initiates ?? 0) + (initiates ? 1 : 0),
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

    if (candidateText) {
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
    }

    if (message.groupId && candidateText) {
      const topic = extractTopic(candidateText);
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

    const messageCount = this.store.countMessages(conversationId);
    const recent = conversationId.endsWith("@g.us")
      ? this.store.recentMessages(conversationId, this.options.recentMessageLimit)
      : this.store.recentChatMessages(conversationId, this.options.recentMessageLimit);
    const previousSummary = this.store.memories(conversationId).find((item) => item.memoryType === "conversation-summary");
    const summaryParts = recent.slice(-8).flatMap((item) => {
      const summaryText = memoryCandidateText(item.text ?? item.media?.caption ?? "");
      return summaryText ? [`${item.senderName ?? item.senderId}: ${summaryText.slice(0, 180)}`] : [];
    });
    if (messageCount >= 5 && messageCount % 5 === 0 && summaryParts.length && Number(previousSummary?.value.messageCount) !== messageCount) {
      const summary = summaryParts.join(" | ");
      await this.saveMemory({
        id: createHash("sha256").update(`${conversationId}:conversation-summary`).digest("hex"),
        scopeType: message.groupId ? "group" : "relationship",
        scopeId: conversationId,
        memoryType: "conversation-summary",
        value: { summary: summary.slice(0, 1800), messageCount },
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

  async maintain(now = Date.now()): Promise<{ stale: number; archived: number; merged: number }> {
    let stale = 0;
    let archived = 0;
    let merged = 0;
    const memories = this.store.memories();
    const duplicateGroups = new Map<string, MemoryRecord[]>();
    for (const memory of memories) {
      if (memory.status !== "DELETED") {
        const key = `${memory.scopeType}:${memory.scopeId}:${memory.memoryType}:${JSON.stringify(memory.value)}`;
        const duplicates = duplicateGroups.get(key) ?? [];
        duplicates.push(memory);
        duplicateGroups.set(key, duplicates);
      }
      if (memory.expiresAt !== undefined && memory.expiresAt <= now) continue;
      const ageDays = (now - memory.lastConfirmedAt) / (24 * 60 * 60 * 1000);
      const nextStatus = ageDays >= this.options.archiveAfterDays
        ? "ARCHIVED"
        : ageDays >= this.options.staleAfterDays
          ? "STALE"
          : memory.status;
      if (nextStatus !== memory.status && memory.status !== "DELETED") {
        await this.saveMemory({ ...memory, status: nextStatus, updatedAt: now });
        if (nextStatus === "STALE") stale += 1;
        if (nextStatus === "ARCHIVED") archived += 1;
      }
    }
    for (const duplicates of duplicateGroups.values()) {
      if (duplicates.length < 2) continue;
      const [primary, ...rest] = duplicates.sort((left, right) => right.updatedAt - left.updatedAt);
      if (!primary) continue;
      const currentPrimary = this.store.memories().find((memory) => memory.id === primary.id) ?? primary;
      const mergedMemory = {
        ...currentPrimary,
        evidenceCount: duplicates.reduce((total, memory) => total + memory.evidenceCount, 0),
        confidence: Math.max(...duplicates.map((memory) => memory.confidence)),
        importance: Math.max(...duplicates.map((memory) => memory.importance)),
        lastConfirmedAt: Math.max(...duplicates.map((memory) => memory.lastConfirmedAt)),
        updatedAt: now,
      };
      await this.saveMemory(mergedMemory);
      for (const duplicate of rest) {
        if (await this.store.deleteMemory(duplicate.id)) {
          await this.onMemoryDelete?.(duplicate.id);
          merged += 1;
        }
      }
    }
    return { stale, archived, merged };
  }

  context(group: GroupRecord, senderId: string, personality: Personality, query = ""): ContextSnapshot {
    const memberId = `${group.id}:${senderId}`;
    const member = this.store.members(group.id).find((item) => item.id === memberId);
    const memories = this.relevantMemories(group.id, memberId, query);
    const history = group.id.endsWith("@g.us")
      ? this.store.recentMessages(group.id, Math.max(this.options.recentMessageLimit * 4, 40))
      : this.store.recentChatMessages(group.id, Math.max(this.options.recentMessageLimit * 4, 40));
    const thread = buildThreadContext(history, query, this.options.recentMessageLimit, this.store);
    const recentActions = this.store.actions(100)
      .filter((action) => action.groupId === group.id && action.status === "SENT")
      .slice(0, 10)
      .map((action) => ({ type: action.actionType, text: typeof action.payload.text === "string" ? action.payload.text.slice(0, 500) : "", timestamp: action.executedAt ?? action.scheduledFor }));
    return {
      group: { id: group.id, subject: group.subject, participantCount: group.participantCount },
       recentMessages: thread.messages,
      ...(member
        ? { member: { displayName: member.displayName, behaviorProfile: member.behaviorProfile, confidence: member.confidence } }
        : {}),
      memories: memories.map((item) => ({ id: item.id, type: item.memoryType, value: item.value, confidence: item.confidence, importance: item.importance, status: item.status })),
       ...(recentActions.length ? { recentActions } : {}),
       personality,
       thread,
     };
  }

  async contextWithSemantic(group: GroupRecord, senderId: string, personality: Personality, query = ""): Promise<ContextSnapshot> {
    const base = this.context(group, senderId, personality, query);
    if (!this.retrieveMemory || !query.trim() || this.options.semanticMemoryLimit === 0) return base;
    const memberId = `${group.id}:${senderId}`;
    const groupScopeType = group.id.endsWith("@g.us") ? "group" : "relationship";
    const [groupHits, memberHits] = await Promise.all([
      this.retrieveMemory(query, group.id, this.options.semanticMemoryLimit),
      this.retrieveMemory(query, memberId, this.options.semanticMemoryLimit),
    ]);
    const stored = new Map(this.store.memories().map((memory) => [memory.id, memory]));
    const semanticScores = new Map<string, number>();
    for (const [hits, scopeId, scopeType] of [[groupHits, group.id, groupScopeType], [memberHits, memberId, "member" as const]] as const) {
      for (const hit of hits) {
        const memory = stored.get(hit.memory.id);
        if (memory && memory.scopeId === scopeId && memory.scopeType === scopeType) semanticScores.set(memory.id, Math.max(semanticScores.get(memory.id) ?? 0, hit.score));
      }
    }
    if (!semanticScores.size) return base;
    return { ...base, memories: this.relevantMemories(group.id, memberId, query, semanticScores).map(formatMemory) };
  }

  private relevantMemories(groupId: string, memberId: string, query: string, semanticScores = new Map<string, number>()): MemoryRecord[] {
    const queryWords = new Set(query.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) ?? []);
    const groupScopeType = groupId.endsWith("@g.us") ? "group" : "relationship";
    const eligible = (items: MemoryRecord[]) => items
      .filter((item) => !item.expiresAt || item.expiresAt > Date.now())
      .filter((item) => item.status !== "ARCHIVED" && item.status !== "DELETED")
      .filter((item) => !queryWords.size || [...queryWords].some((word) => JSON.stringify(item.value).toLowerCase().includes(word)) || (semanticScores.get(item.id) ?? 0) >= 0.45)
      .sort((left, right) => memoryScore(right, queryWords, semanticScores.get(right.id)) - memoryScore(left, queryWords, semanticScores.get(left.id)));
    return [
      ...eligible(this.store.memories(groupId).filter((memory) => memory.scopeType === groupScopeType)).slice(0, this.options.groupMemoryLimit),
      ...eligible(this.store.memories(memberId).filter((memory) => memory.scopeType === "member")).slice(0, this.options.memberMemoryLimit),
    ];
  }
}

function formatMemory(memory: MemoryRecord): ContextSnapshot["memories"][number] {
  return { id: memory.id, type: memory.memoryType, value: memory.value, confidence: memory.confidence, importance: memory.importance, status: memory.status };
}

function buildThreadContext(history: StoredMessage[], query: string, limit: number, store: Store): ThreadContext {
  const current = history.at(-1);
  if (!current) return { state: "new_topic", confidence: 1, messages: [] };
  if (!query.trim()) {
    return { state: "continuation", confidence: 0.35, messages: history.slice(-limit).map(formatContextMessage) };
  }

  const linked = new Set<string>([current.id]);
  const chainMessages: StoredMessage[] = [current];
  let parentId = current.quotedMessageId;
  let anchorMessageId: string | undefined;
  for (let depth = 0; parentId && depth < 12; depth += 1) {
    const parent = store.message(parentId);
    if (!parent) break;
    linked.add(parent.id);
    chainMessages.push(parent);
    anchorMessageId ??= parent.id;
    parentId = parent.quotedMessageId;
  }
  if (anchorMessageId) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const message of history) {
        if (message.quotedMessageId && linked.has(message.quotedMessageId) && !linked.has(message.id)) {
          linked.add(message.id);
          expanded = true;
        }
      }
    }
    const related = new Map<string, StoredMessage>();
    for (const message of history.filter((message) => linked.has(message.id))) related.set(message.id, message);
    for (const message of chainMessages) related.set(message.id, message);
    return {
      state: "reply_chain",
      confidence: 1,
      anchorMessageId,
      messages: [...related.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-limit).map(formatContextMessage),
    };
  }

  const queryWords = threadWords(query);
  const scored = history.map((message) => ({ message, score: tokenOverlap(queryWords, threadWords(message.text ?? message.media?.caption ?? "")) }));
  const now = current.timestamp;
  const activeMatches = scored.filter(({ message, score }) => message.id !== current.id && score >= 0.25 && now - message.timestamp <= THREAD_WINDOW_MS);
  if (activeMatches.length) {
    const anchor = activeMatches.at(-1)?.message;
    const selected = scored.filter(({ message, score }) => message.id === current.id || (score >= 0.25 && now - message.timestamp <= THREAD_WINDOW_MS)).slice(-limit).map(({ message }) => formatContextMessage(message));
    return { state: "continuation", confidence: Math.min(0.95, 0.55 + Math.max(...activeMatches.map(({ score }) => score)) * 0.4), ...(anchor ? { anchorMessageId: anchor.id } : {}), messages: selected };
  }

  if (isFollowUp(query)) {
    const recent = history.filter((message) => now - message.timestamp <= FOLLOW_UP_WINDOW_MS).slice(-limit).map(formatContextMessage);
    if (recent.length > 1) return { state: "continuation", confidence: 0.55, messages: recent };
  }
  return { state: "new_topic", confidence: 0.9, messages: [formatContextMessage(current)] };
}

function formatContextMessage(message: StoredMessage): ContextMessage {
  return {
    sender: message.senderName ?? message.senderId,
    text: (message.text ?? `[${message.type}]`).slice(0, 500),
    type: message.type,
    timestamp: message.timestamp,
  };
}

function threadWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? []).filter((word) => !THREAD_STOP_WORDS.has(word)));
}

function tokenOverlap(queryWords: Set<string>, messageWords: Set<string>): number {
  if (!queryWords.size || !messageWords.size) return 0;
  let matches = 0;
  for (const word of queryWords) if (messageWords.has(word)) matches += 1;
  return matches / queryWords.size;
}

function isFollowUp(text: string): boolean {
  return text.trim().split(/\s+/).length <= 14 && /^(?:yes|no|okay|ok|and|also|then|so|but|what about|how about|why|how|that|this|it|he|she|they|more|explain)\b/i.test(text.trim());
}

const THREAD_WINDOW_MS = 30 * 60_000;
const FOLLOW_UP_WINDOW_MS = 15 * 60_000;
const THREAD_STOP_WORDS = new Set(["about", "after", "again", "also", "and", "are", "can", "could", "from", "have", "how", "into", "just", "like", "more", "not", "now", "please", "should", "that", "the", "their", "then", "this", "what", "when", "where", "which", "who", "why", "with", "would", "you", "your"]);

function memoryScore(memory: MemoryRecord, queryWords: Set<string>, semanticScore?: number): number {
  const searchable = JSON.stringify(memory.value).toLowerCase();
  const matches = [...queryWords].filter((word) => searchable.includes(word)).length;
  const exactRelevance = queryWords.size ? matches / queryWords.size : 0.5;
  const semanticRelevance = semanticScore === undefined ? exactRelevance : Math.max(0, Math.min(1, semanticScore));
  const ageDays = Math.max(0, (Date.now() - memory.lastConfirmedAt) / (24 * 60 * 60 * 1000));
  const recency = Math.exp(-ageDays / 30);
  const statusWeight = memory.status === "STALE" ? 0.5 : memory.status === "WEAK" ? 0.75 : 1;
  return (semanticRelevance * 0.5 + exactRelevance * 0.2 + memory.confidence * 0.15 + memory.importance * 0.1 + recency * 0.05) * statusWeight;
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
  const stopWords = new Set(["a", "an", "am", "are", "as", "at", "be", "but", "by", "can", "do", "for", "from", "has", "have", "he", "her", "hey", "hi", "how", "i", "if", "in", "is", "it", "just", "me", "my", "of", "on", "or", "our", "please", "that", "the", "their", "there", "they", "this", "to", "was", "we", "what", "when", "where", "which", "who", "with", "would", "you", "your"]);
  const noise = new Set(["abi", "abeg", "haha", "hehe", "lmao", "lol", "na", "omo", "okay", "ok", "sha", "thanks", "thank", "una"]);
  if (/^[\p{Extended_Pictographic}\s!?.,😂🤣😭]+$/u.test(text.trim())) return undefined;
  return text.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g)?.find((word) => !stopWords.has(word) && !noise.has(word) && !/^(https?|www|message)$/.test(word));
}

const LOW_VALUE_TOKENS = new Set([
  "abi", "abeg", "afternoon", "are", "evening", "everyone", "good", "guys", "haha", "hehe", "hello", "hey", "hi", "lmao", "lol", "morning", "na", "no", "ok", "okay", "omo", "please", "thanks", "thank", "the", "there", "wow", "yeah", "yes", "yo",
]);

function memoryCandidateText(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 3 || containsSensitiveContent(normalized)) return undefined;
  const words = normalized.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0 && /^[\p{Extended_Pictographic}\s!?.,]+$/u.test(normalized)) return undefined;
  if (words.length > 0 && words.length <= 6 && words.every((word) => LOW_VALUE_TOKENS.has(word))) return undefined;
  return normalized.slice(0, 8_000);
}

function containsSensitiveContent(text: string): boolean {
  if (/\b(?:password|passcode|one[- ]time(?: password| code)?|otp|api key|secret key|private key|cvv|credit card|bank account|social security|national id|nin|bvn)\b/i.test(text)) return true;
  return /\b(?:i(?:'m| am)|my)\s+(?:pregnant|diabetic|depressed|diagnosed|allergic|hiv|aids|cancer|muslim|christian|jewish|hindu|gay|lesbian|bisexual|transgender)\b/i.test(text);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
