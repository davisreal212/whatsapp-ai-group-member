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
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  TAVILY_API_KEY: optionalString,
  TAVILY_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: z.string().default("z-ai/glm-5.2:free"),
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
    messageRetentionDays: values.MESSAGE_RETENTION_DAYS,
    tavilyApiKey: values.TAVILY_API_KEY,
    tavilyMaxResults: values.TAVILY_MAX_RESULTS,
    geminiApiKey: values.GEMINI_API_KEY,
    geminiModel: values.GEMINI_MODEL,
    groqApiKey: values.GROQ_API_KEY,
    groqModel: values.GROQ_MODEL,
    openRouterApiKey: values.OPENROUTER_API_KEY,
    openRouterModel: values.OPENROUTER_MODEL,
    personality,
  };
}
