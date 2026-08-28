export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "PAIRING"
  | "CONNECTED"
  | "RECONNECTING"
  | "REQUIRES_REPAIR";

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
  genderPresentation: "neutral" | "masculine" | "feminine";
  tone: "casual" | "playful" | "warm" | "formal";
  talkativeness: number;
  confidence: number;
  formality: number;
  languageMix: "english" | "pidgin" | "mixed";
  emojiFrequency: number;
  initiative: number;
  responseLength: "short" | "medium" | "long";
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
  groupOnlyMode: boolean;
  directMessageAllowlist: string[];
  dryRun: boolean;
  outboundPaused: boolean;
  aiProcessingPaused: boolean;
  groupCooldownMs: number;
  dailyActionLimit: number;
  messageRetentionDays: number;
  tavilyApiKey?: string;
  tavilyMaxResults: number;
  geminiApiKey?: string;
  geminiModel: string;
  groqApiKey?: string;
  groqModel: string;
  openRouterApiKey?: string;
  openRouterModel: string;
  personality: Personality;
}

export interface MediaMetadata {
  mimeType?: string;
  fileLength?: number;
  durationSeconds?: number;
  caption?: string;
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
  personalityOverride?: Partial<Personality>;
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

export interface MemoryRecord {
  id: string;
  scopeType: "group" | "member" | "relationship" | "source";
  scopeId: string;
  memoryType: string;
  value: Record<string, unknown>;
  confidence: number;
  evidenceCount: number;
  createdAt: number;
  lastConfirmedAt: number;
  expiresAt?: number;
}

export interface StoredMessage extends CanonicalMessage {
  storedAt: number;
}

export interface DecisionPlan {
  decision: Decision;
  confidence: number;
  reason: string;
  targetMessageId?: string;
  reaction?: string;
  text?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  delayMs: number;
  needsWeb: boolean;
  needsMedia: boolean;
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
  executedAt?: number;
  error?: string;
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
  actions: Record<string, ActionRecord>;
  logs: AuditLog[];
  providerUsage: ProviderUsageRecord[];
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  settings?: {
    outboundPaused?: boolean;
    aiProcessingPaused?: boolean;
    directMessageAllowlist?: string[];
    personality?: Partial<Personality>;
  };
  runtime: {
    connectionStatus: ConnectionStatus;
    pairingCode?: string;
    lastConnectedAt?: number;
    metrics: AppMetrics;
  };
}
