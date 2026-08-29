import "dotenv/config";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { AppConfig, Personality } from "./types.js";

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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().default("./data"),
  WHATSAPP_AUTH_DIR: z.string().default("./data/whatsapp-auth"),
  DATABASE_URL: optionalString,
  ADMIN_TOKEN: optionalString,
  BOT_NAME: z.string().min(1).max(40).default("Kola"),
  BOT_JID: optionalString,
  GROUP_ONLY_MODE: booleanString.default(true),
  DIRECT_MESSAGE_ALLOWLIST: z.string().default(""),
  DRY_RUN: booleanString.default(true),
  OUTBOUND_PAUSED: booleanString.default(false),
  AI_PROCESSING_PAUSED: booleanString.default(false),
  GROUP_COOLDOWN_MS: z.coerce.number().int().min(0).max(86_400_000).default(30_000),
  DAILY_ACTION_LIMIT: z.coerce.number().int().min(0).max(10_000).default(50),
  ACTIONS_PER_MINUTE: z.coerce.number().int().min(0).max(1_000).default(10),
  ACTIONS_PER_HOUR: z.coerce.number().int().min(0).max(10_000).default(50),
  ACTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  QUIET_HOURS_START: z.coerce.number().int().min(-1).max(23).default(-1),
  QUIET_HOURS_END: z.coerce.number().int().min(-1).max(23).default(-1),
  BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  BACKUP_RETENTION_COUNT: z.coerce.number().int().min(1).max(100).default(7),
  AUDIO_REPLY_MODE: z.enum(["text", "adaptive", "always"]).default("text"),
  TTS_API_KEY: optionalString,
  TTS_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  TTS_MODEL: z.string().min(1).max(100).default("gpt-4o-mini-tts"),
  TTS_VOICE: z.string().min(1).max(100).default("alloy"),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: z.string().min(1).max(100).default("21m00Tcm4TlvDq8ikWAM"),
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
  PROVIDER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  PROVIDER_COOLDOWN_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = envSchema.parse(environment);
  if (values.NODE_ENV === "production" && (!values.ADMIN_TOKEN || values.ADMIN_TOKEN.length < 24)) {
    throw new Error("ADMIN_TOKEN must be at least 24 characters when NODE_ENV=production");
  }
  if (values.NODE_ENV === "production" && !values.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production");
  }
  if (values.NODE_ENV === "production" && (!isAbsolute(values.DATA_DIR) || !isAbsolute(values.WHATSAPP_AUTH_DIR))) {
    throw new Error("DATA_DIR and WHATSAPP_AUTH_DIR must be absolute persistent paths in production");
  }

  const personality: Personality = {
    displayName: values.BOT_NAME,
    genderPresentation: "neutral",
    tone: "casual",
    talkativeness: 0.35,
    confidence: 0.7,
    formality: 0.25,
    languageMix: "mixed",
    emojiFrequency: 0.15,
    initiative: 0.3,
    responseLength: "short",
  };

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
    dailyActionLimit: values.DAILY_ACTION_LIMIT,
    actionsPerMinute: values.ACTIONS_PER_MINUTE,
    actionsPerHour: values.ACTIONS_PER_HOUR,
    actionMaxAttempts: values.ACTION_MAX_ATTEMPTS,
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
    providerFailureThreshold: values.PROVIDER_FAILURE_THRESHOLD,
    providerCooldownMs: values.PROVIDER_COOLDOWN_MS,
    personality,
  };
}
