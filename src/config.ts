import "dotenv/config";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { AppConfig, Personality } from "./types.js";
import { DEFAULT_PARTICIPATION } from "./participation.js";
import { defaultPersonality } from "./persona.js";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const booleanString = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  },
  z.boolean().default(false),
);

const optionalBoolean = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  },
  z.boolean().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().default("./data"),
  WHATSAPP_AUTH_DIR: z.string().default("./data/whatsapp-auth"),
  DATABASE_URL: optionalString,
  ADMIN_TOKEN: optionalString,
  BOT_NAME: z.string().min(1).max(40).default("Kola"),
  BOT_JID: optionalString,
  GROUP_ONLY_MODE: booleanString.default(false),
  DIRECT_MESSAGE_ALLOWLIST: z.string().default(""),
  DRY_RUN: booleanString.default(true),
  OUTBOUND_PAUSED: booleanString.default(false),
  AI_PROCESSING_PAUSED: booleanString.default(false),
  GROUP_COOLDOWN_MS: z.coerce.number().int().min(0).max(86_400_000).default(DEFAULT_PARTICIPATION.groupCooldownMs),
  DIRECT_REPLY_BYPASS: booleanString.default(DEFAULT_PARTICIPATION.directReplyBypass),
  DIRECT_MENTION_BYPASS: booleanString.default(DEFAULT_PARTICIPATION.directMentionBypass),
  DIRECT_REPLY_DELAY_MIN_MS: z.coerce.number().int().min(0).max(60_000).default(DEFAULT_PARTICIPATION.directReplyDelayMinMs),
  DIRECT_REPLY_DELAY_MAX_MS: z.coerce.number().int().min(0).max(60_000).default(DEFAULT_PARTICIPATION.directReplyDelayMaxMs),
  DIRECT_MENTION_DELAY_MIN_MS: z.coerce.number().int().min(0).max(60_000).default(DEFAULT_PARTICIPATION.directMentionDelayMinMs),
  DIRECT_MENTION_DELAY_MAX_MS: z.coerce.number().int().min(0).max(60_000).default(DEFAULT_PARTICIPATION.directMentionDelayMaxMs),
  ADAPTIVE_ACTIVITY: booleanString.default(DEFAULT_PARTICIPATION.adaptiveActivity),
  GROUP_MENTION_ALL_COOLDOWN_MS: z.coerce.number().int().min(0).max(86_400_000).default(DEFAULT_PARTICIPATION.groupMentionAllCooldownMs),
  DAILY_ACTION_LIMIT: z.coerce.number().int().min(0).max(10_000).default(50),
  ACTIONS_PER_MINUTE: z.coerce.number().int().min(0).max(1_000).default(10),
  ACTIONS_PER_HOUR: z.coerce.number().int().min(0).max(10_000).default(50),
  ACTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  QUIET_HOURS_ENABLED: optionalBoolean,
  QUIET_HOURS_START: z.coerce.number().int().min(-1).max(23).default(22),
  QUIET_HOURS_END: z.coerce.number().int().min(-1).max(23).default(7),
  BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  BACKUP_RETENTION_COUNT: z.coerce.number().int().min(1).max(100).default(7),
  AUDIO_REPLY_MODE: z.enum(["text", "adaptive", "always"]).default("text"),
  TTS_API_KEY: optionalString,
  TTS_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  TTS_MODEL: z.string().min(1).max(100).default("gpt-4o-mini-tts"),
  TTS_VOICE: z.string().min(1).max(100).default("alloy"),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_API_BASE_URL: z.string().url().default("https://api.elevenlabs.io"),
  ELEVENLABS_VOICE_ID: z.string().min(1).max(100).default("21m00Tcm4TlvDq8ikWAM"),
  ELEVENLABS_TTS_MODEL: z.string().min(1).max(100).default("eleven_multilingual_v2"),
  ELEVENLABS_AGENT_ID: optionalString,
  ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID: optionalString,
  ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME: optionalString,
  ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE_CODE: optionalString,
  CMC_API_KEY: optionalString,
  MAX_MEDIA_BYTES: z.coerce.number().int().min(1_024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().min(1).max(3_600).default(300),
  MEDIA_DOWNLOADS_PER_HOUR: z.coerce.number().int().min(0).max(10_000).default(100),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  TAVILY_API_KEY: optionalString,
  TAVILY_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: z.string().default("z-ai/glm-5.2:free"),
  PHOENIX_API_KEY: optionalString,
  PHOENIX_API_BASE_URL: z.string().url().default("https://fastapi-ai-koyeb-app-production.up.railway.app"),
  PHOENIX_PRIMARY_MODEL: z.string().min(1).max(100).default("deepseek-v4-flash"),
  PHOENIX_SECONDARY_MODEL: z.string().min(1).max(100).default("glm-5.3"),
  QDRANT_URL: optionalString,
  QDRANT_API_KEY: optionalString,
  QDRANT_COLLECTION: z.string().min(1).max(100).default("memories"),
  EMBEDDING_PROVIDER: z.enum(["none", "gemini", "qdrant"]).default("none"),
  EMBEDDING_MODEL: z.string().min(1).max(100).default("intfloat/multilingual-e5-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(3072).default(384),
  MEMORY_RECENT_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  MEMORY_GROUP_LIMIT: z.coerce.number().int().min(0).max(50).default(10),
  MEMORY_MEMBER_LIMIT: z.coerce.number().int().min(0).max(20).default(5),
  MEMORY_SEMANTIC_LIMIT: z.coerce.number().int().min(0).max(20).default(5),
  MEMORY_STALE_AFTER_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  MEMORY_ARCHIVE_AFTER_DAYS: z.coerce.number().int().min(2).max(3650).default(90),
  PROVIDER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  PROVIDER_COOLDOWN_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = envSchema.parse(environment);
  if (values.DIRECT_REPLY_DELAY_MAX_MS < values.DIRECT_REPLY_DELAY_MIN_MS) throw new Error("DIRECT_REPLY_DELAY_MAX_MS must be at least DIRECT_REPLY_DELAY_MIN_MS");
  if (values.DIRECT_MENTION_DELAY_MAX_MS < values.DIRECT_MENTION_DELAY_MIN_MS) throw new Error("DIRECT_MENTION_DELAY_MAX_MS must be at least DIRECT_MENTION_DELAY_MIN_MS");
  if (values.NODE_ENV === "production" && (!values.ADMIN_TOKEN || values.ADMIN_TOKEN.length < 24)) {
    throw new Error("ADMIN_TOKEN must be at least 24 characters when NODE_ENV=production");
  }
  if (values.NODE_ENV === "production" && !values.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production");
  }
  if (values.NODE_ENV === "production" && (!isAbsolute(values.DATA_DIR) || !isAbsolute(values.WHATSAPP_AUTH_DIR))) {
    throw new Error("DATA_DIR and WHATSAPP_AUTH_DIR must be absolute persistent paths in production");
  }

  const personality: Personality = defaultPersonality(values.BOT_NAME);

  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    dataDir: values.DATA_DIR,
    whatsappAuthDir: values.WHATSAPP_AUTH_DIR,
    databaseUrl: values.DATABASE_URL,
    adminToken: values.ADMIN_TOKEN,
    botName: values.BOT_NAME,
    botJid: values.BOT_JID,
    botJids: values.BOT_JID ? [values.BOT_JID] : [],
    groupOnlyMode: values.GROUP_ONLY_MODE,
    directMessageAllowlist: values.DIRECT_MESSAGE_ALLOWLIST.split(",").map((value) => value.trim()).filter(Boolean),
    dryRun: values.DRY_RUN,
    outboundPaused: values.OUTBOUND_PAUSED,
    aiProcessingPaused: values.AI_PROCESSING_PAUSED,
    groupCooldownMs: values.GROUP_COOLDOWN_MS,
    participation: {
      groupCooldownMs: values.GROUP_COOLDOWN_MS,
      directReplyBypass: values.DIRECT_REPLY_BYPASS,
      directMentionBypass: values.DIRECT_MENTION_BYPASS,
      directReplyDelayMinMs: values.DIRECT_REPLY_DELAY_MIN_MS,
      directReplyDelayMaxMs: values.DIRECT_REPLY_DELAY_MAX_MS,
      directMentionDelayMinMs: values.DIRECT_MENTION_DELAY_MIN_MS,
      directMentionDelayMaxMs: values.DIRECT_MENTION_DELAY_MAX_MS,
      adaptiveActivity: values.ADAPTIVE_ACTIVITY,
      groupMentionAllCooldownMs: values.GROUP_MENTION_ALL_COOLDOWN_MS,
    },
    dailyActionLimit: values.DAILY_ACTION_LIMIT,
    actionsPerMinute: values.ACTIONS_PER_MINUTE,
    actionsPerHour: values.ACTIONS_PER_HOUR,
    actionMaxAttempts: values.ACTION_MAX_ATTEMPTS,
    quietHoursEnabled: values.QUIET_HOURS_ENABLED ?? values.NODE_ENV === "production",
    quietHoursStart: values.QUIET_HOURS_START,
    quietHoursEnd: values.QUIET_HOURS_END,
    backupIntervalHours: values.BACKUP_INTERVAL_HOURS,
    backupRetentionCount: values.BACKUP_RETENTION_COUNT,
    audioReplyMode: values.AUDIO_REPLY_MODE,
    ttsApiKey: values.TTS_API_KEY,
    ttsBaseUrl: values.TTS_BASE_URL,
    ttsModel: values.TTS_MODEL,
    ttsVoice: values.TTS_VOICE,
    elevenLabsApiKey: values.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: values.ELEVENLABS_VOICE_ID,
    elevenLabsTtsModel: values.ELEVENLABS_TTS_MODEL,
    elevenLabsApiBaseUrl: values.ELEVENLABS_API_BASE_URL,
    elevenLabsAgentId: values.ELEVENLABS_AGENT_ID,
    elevenLabsWhatsAppPhoneNumberId: values.ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID,
    elevenLabsWhatsAppCallPermissionTemplateName: values.ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME,
    elevenLabsWhatsAppCallPermissionTemplateLanguageCode: values.ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE_CODE,
    cmcApiKey: values.CMC_API_KEY,
    maxMediaBytes: values.MAX_MEDIA_BYTES,
    maxVideoDurationSeconds: values.MAX_VIDEO_DURATION_SECONDS,
    mediaDownloadsPerHour: values.MEDIA_DOWNLOADS_PER_HOUR,
    messageRetentionDays: values.MESSAGE_RETENTION_DAYS,
    tavilyApiKey: values.TAVILY_API_KEY,
    tavilyMaxResults: values.TAVILY_MAX_RESULTS,
    geminiApiKey: values.GEMINI_API_KEY,
    geminiModel: values.GEMINI_MODEL,
    groqApiKey: values.GROQ_API_KEY,
    groqModel: values.GROQ_MODEL,
    openRouterApiKey: values.OPENROUTER_API_KEY,
    openRouterModel: values.OPENROUTER_MODEL,
    phoenixApiKey: values.PHOENIX_API_KEY,
    phoenixApiBaseUrl: values.PHOENIX_API_BASE_URL,
    phoenixPrimaryModel: values.PHOENIX_PRIMARY_MODEL,
    phoenixSecondaryModel: values.PHOENIX_SECONDARY_MODEL,
    qdrantUrl: values.QDRANT_URL,
    qdrantApiKey: values.QDRANT_API_KEY,
    qdrantCollection: values.QDRANT_COLLECTION,
    embeddingProvider: values.EMBEDDING_PROVIDER,
    embeddingModel: values.EMBEDDING_MODEL,
    embeddingDimensions: values.EMBEDDING_DIMENSIONS,
    memoryRecentMessageLimit: values.MEMORY_RECENT_MESSAGE_LIMIT,
    memoryGroupLimit: values.MEMORY_GROUP_LIMIT,
    memoryMemberLimit: values.MEMORY_MEMBER_LIMIT,
    memorySemanticLimit: values.MEMORY_SEMANTIC_LIMIT,
    memoryStaleAfterDays: values.MEMORY_STALE_AFTER_DAYS,
    memoryArchiveAfterDays: Math.max(values.MEMORY_STALE_AFTER_DAYS + 1, values.MEMORY_ARCHIVE_AFTER_DAYS),
    providerFailureThreshold: values.PROVIDER_FAILURE_THRESHOLD,
    providerCooldownMs: values.PROVIDER_COOLDOWN_MS,
    personality,
  };
}
