export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "PAIRING"
  | "CONNECTED"
  | "RECONNECTING"
  | "REQUIRES_REPAIR";

export type LanguagePreference = "english" | "pidgin" | "yoruba" | "igbo" | "hausa" | "french" | "spanish" | "chinese" | "mixed" | "auto" | (string & {});

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "reaction"
  | "unknown";

export type Decision =
  | "IGNORE"
  | "REACT"
  | "REPLY"
  | "REPLY_QUOTED"
  | "MENTION_REPLY"
  | "SEND_IMAGE"
  | "SEND_AUDIO";

export interface Personality {
  displayName: string;
  genderPresentation: "neutral" | "masculine" | "feminine" | "custom";
  tone: "casual" | "playful" | "warm" | "formal";
  talkativeness: number;
  confidence: number;
  formality: number;
  languageMix: LanguagePreference;
  emojiFrequency: number;
  initiative: number;
  responseLength: "short" | "medium" | "long";
  customDescription?: string;
  personalityPresets: string[];
  humorLevel: number;
  languages: string[];
  respondToMentions: boolean;
  respondToReplies: boolean;
  joinRelevantConversations: boolean;
  initiateConversations: boolean;
  initiationIntervalMs: number;
  maxDailyInitiations: number;
  memoryEnabled: boolean;
  webSearchEnabled: boolean;
  mediaSkillsEnabled: boolean;
  voiceSkillsEnabled: boolean;
}

export interface ParticipationSettings {
  groupCooldownMs: number;
  directReplyBypass: boolean;
  directMentionBypass: boolean;
  directReplyDelayMinMs: number;
  directReplyDelayMaxMs: number;
  directMentionDelayMinMs: number;
  directMentionDelayMaxMs: number;
  adaptiveActivity: boolean;
  groupMentionAllCooldownMs: number;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  dataDir: string;
  whatsappAuthDir: string;
  databaseUrl?: string;
  adminToken?: string;
  botName: string;
  botJid?: string;
  botJids: string[];
  groupOnlyMode: boolean;
  directMessageAllowlist: string[];
  dryRun: boolean;
  outboundPaused: boolean;
  aiProcessingPaused: boolean;
  groupCooldownMs: number;
  participation: ParticipationSettings;
  dailyActionLimit: number;
  actionsPerMinute: number;
  actionsPerHour: number;
  actionMaxAttempts: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  backupIntervalHours: number;
  backupRetentionCount: number;
  audioReplyMode: "text" | "adaptive" | "always";
  ttsApiKey?: string;
  ttsBaseUrl: string;
  ttsModel: string;
  ttsVoice: string;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId: string;
  elevenLabsTtsModel: string;
  elevenLabsApiBaseUrl: string;
  elevenLabsAgentId?: string;
  elevenLabsWhatsAppPhoneNumberId?: string;
  elevenLabsWhatsAppCallPermissionTemplateName?: string;
  elevenLabsWhatsAppCallPermissionTemplateLanguageCode?: string;
  cmcApiKey?: string;
  maxMediaBytes: number;
  maxVideoDurationSeconds: number;
  mediaDownloadsPerHour: number;
  messageRetentionDays: number;
  tavilyApiKey?: string;
  tavilyMaxResults: number;
  geminiApiKey?: string;
  geminiModel: string;
  groqApiKey?: string;
  groqModel: string;
  openRouterApiKey?: string;
  openRouterModel: string;
  phoenixApiKey?: string;
  phoenixApiBaseUrl: string;
  phoenixPrimaryModel: string;
  phoenixSecondaryModel: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  qdrantCollection: string;
  embeddingProvider: "none" | "gemini";
  embeddingModel: string;
  embeddingDimensions: number;
  memoryRecentMessageLimit: number;
  memoryGroupLimit: number;
  memoryMemberLimit: number;
  memorySemanticLimit: number;
  memoryStaleAfterDays: number;
  memoryArchiveAfterDays: number;
  providerFailureThreshold: number;
  providerCooldownMs: number;
  personality: Personality;
}

export interface MediaMetadata {
  mimeType?: string;
  fileLength?: number;
  durationSeconds?: number;
  caption?: string;
  description?: string;
  ocrText?: string;
  hasDownloadableContent: boolean;
}

export interface CanonicalMessage {
  id: string;
  chatId: string;
  groupId?: string;
  senderId: string;
  senderPhone?: string;
  senderName?: string;
  timestamp: number;
  type: MessageType;
  text?: string;
  transcriptConfidence?: number;
  transcriptLanguage?: string;
  quotedMessageId?: string;
  quotedSenderId?: string;
  mentionedIds: string[];
  media?: MediaMetadata;
  isGroup: boolean;
  isStatus: boolean;
  isFromBot: boolean;
}

export interface GroupRecord {
  id: string;
  whatsappGroupId: string;
  subject: string;
  participantCount: number;
  isAdmin: boolean;
  enabled: boolean;
  aiPaused: boolean;
  learningEnabled?: boolean;
  personalityOverride?: Partial<Personality>;
  participationOverride?: Partial<ParticipationSettings>;
  lastSeenAt: number;
}

export interface MemberRecord {
  id: string;
  groupId: string;
  whatsappMemberId: string;
  displayName?: string;
  behaviorProfile: {
    averageMessageLength: number;
    emojiFrequency: number;
    languageStyle?: "english" | "pidgin" | "mixed" | "unknown";
    messageCount: number;
    initiates: number;
    replies: number;
  };
  confidence: Record<string, number>;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type MemoryStatus = "ACTIVE" | "WEAK" | "STALE" | "ARCHIVED" | "DELETED";

export interface MemoryRecord {
  id: string;
  scopeType: "group" | "member" | "relationship" | "source";
  scopeId: string;
  memoryType: string;
  value: Record<string, unknown>;
  confidence: number;
  importance: number;
  status: MemoryStatus;
  evidenceCount: number;
  createdAt: number;
  lastConfirmedAt: number;
  updatedAt: number;
  sourceMessageId?: string;
  sourceTimestamp?: number;
  sourceMemberId?: string;
  expiresAt?: number;
}

export type MemoryUpsertHook = (memory: MemoryRecord) => Promise<void>;
export type MemoryDeleteHook = (memoryId: string) => Promise<void>;

export interface SemanticMemoryHit {
  memory: MemoryRecord;
  score: number;
}

export type MemoryRetriever = (query: string, scopeId: string, limit?: number) => Promise<SemanticMemoryHit[]>;

export type MemoryVectorJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface MemoryVectorJobRecord {
  id: string;
  memoryId: string;
  operation: "UPSERT" | "DELETE";
  memoryUpdatedAt: number;
  status: MemoryVectorJobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
  lastError?: string;
}

export type MemoryVectorJobExpectation = Pick<MemoryVectorJobRecord, "operation" | "memoryUpdatedAt" | "status" | "attempts">;

export interface StoredMessage extends CanonicalMessage {
  storedAt: number;
}

export type InboundJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface InboundJobRecord {
  id: string;
  messageId: string;
  chatId: string;
  message: CanonicalMessage;
  status: InboundJobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
  lastError?: string;
}

export interface DecisionPlan {
  decision: Decision;
  confidence: number;
  reason: string;
  targetMessageId?: string;
  reaction?: string;
  text?: string;
  mediaQuery?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  delayMs: number;
  needsWeb: boolean;
  needsMedia: boolean;
  priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  bypassCooldown?: boolean;
  mentionAll?: boolean;
  responseStyle: "short_casual" | "helpful" | "playful" | "uncertain";
}

export interface ActionRecord {
  id: string;
  idempotencyKey: string;
  groupId: string;
  sourceMessageId: string;
  actionType: Decision;
  targetMessageId?: string;
  payload: Record<string, unknown>;
  scheduledFor: number;
  status: "PENDING" | "SENT" | "SKIPPED" | "FAILED";
  attempts?: number;
  nextAttemptAt?: number;
  executedAt?: number;
  error?: string;
}

export type TaskType = "PRICE_ALERT" | "REMINDER" | "SCHEDULED_MESSAGE" | "MONITOR" | "CUSTOM";
export type TaskStatus = "ACTIVE" | "TRIGGERED" | "PAUSED" | "CANCELLED";
export type TaskRecurrence = "ONCE" | "DAILY" | "WEEKLY";

export interface TaskCondition {
  asset?: string;
  operator?: "gte" | "lte";
  threshold?: number;
  currency?: string;
}

export interface TaskRecord {
  id: string;
  groupId: string;
  creatorId: string;
  creatorChatId: string;
  type: TaskType;
  condition?: TaskCondition;
  message: string;
  status: TaskStatus;
  triggerAt?: number;
  recurrence: TaskRecurrence;
  notificationTarget: "GROUP" | "USER";
  notificationChatId: string;
  createdAt: number;
  lastCheckedAt?: number;
  lastSuccessfulCheck?: number;
  lastError?: string;
  retryCount: number;
}

export interface AuditLog {
  id: string;
  event: string;
  level: "info" | "warn" | "error";
  messageId?: string;
  groupId?: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface ProviderUsageRecord {
  provider: string;
  operation: string;
  groupId?: string;
  units: number;
  success: boolean;
  latencyMs: number;
  createdAt: number;
}

export type UserRole = "admin" | "user";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: number;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface EvidenceSource {
  url: string;
  title?: string;
  publishedAt?: string;
  sourceType: "official" | "news" | "reference" | "unknown";
  retrievedAt: number;
  evidence?: string;
}

export interface EvidenceBundle {
  question: string;
  claims: Array<{ claim: string; support: string[]; confidence: number }>;
  contradictions: string[];
  sources: EvidenceSource[];
  freshness: "recent" | "stale" | "unknown";
  verdict: "verified" | "mixed" | "unverified";
}

export interface AppMetrics {
  observed: number;
  ignoredLocally: number;
  aiCalls: number;
  webSearches: number;
  providerFailures: number;
  actionsSent: number;
  actionsSkipped: number;
  actionFailures: number;
}

export interface PersistedState {
  groups: Record<string, GroupRecord>;
  members: Record<string, MemberRecord>;
  messages: Record<string, StoredMessage>;
  memories: Record<string, MemoryRecord>;
  memoryVectorJobs: Record<string, MemoryVectorJobRecord>;
  actions: Record<string, ActionRecord>;
  tasks: Record<string, TaskRecord>;
  inboundJobs: Record<string, InboundJobRecord>;
  logs: AuditLog[];
  providerUsage: ProviderUsageRecord[];
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  settings?: {
    outboundPaused?: boolean;
    aiProcessingPaused?: boolean;
    directMessageAllowlist?: string[];
    personality?: Partial<Personality>;
    languagePreferenceConfigured?: boolean;
    participation?: Partial<ParticipationSettings>;
    skillOverrides?: Record<string, boolean>;
    dmLanguagePreferences?: Record<string, LanguagePreference>;
  };
  runtime: {
    connectionStatus: ConnectionStatus;
    pairingCode?: string;
    lastConnectedAt?: number;
    metrics: AppMetrics;
  };
}
