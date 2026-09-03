import { createHash } from "node:crypto";

export interface DownloadedMedia {
  data: Buffer;
  mimeType: string;
}

export interface TranscriptResult {
  text: string;
  confidence: number;
  language?: string;
}

export interface VisionResult {
  description: string;
  ocrText?: string;
  confidence: number;
  animalSpecies?: "cat" | "dog" | "other" | "unclear" | "none";
}

export interface DocumentTextResult {
  text: string;
  mimeType: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  readonly available: boolean;
  transcribe(media: DownloadedMedia): Promise<TranscriptResult>;
}

export interface VisionProvider {
  readonly name: string;
  readonly available: boolean;
  analyze(media: DownloadedMedia, context?: VisionAnalysisContext): Promise<VisionResult>;
}

export interface VisionAnalysisContext {
  messageType?: "image" | "sticker";
  caption?: string;
}

export interface TextToSpeechProvider {
  readonly name: string;
  readonly available: boolean;
  synthesize(text: string): Promise<DownloadedMedia>;
}

export interface MediaActivity {
  active: boolean;
  operations: Array<{ operation: "transcription" | "vision" | "text_to_speech"; provider: string; startedAt: number }>;
  lastOperation?: "transcription" | "vision" | "text_to_speech";
  lastProvider?: string;
  lastStatus?: "succeeded" | "failed";
  lastFinishedAt?: number;
  lastError?: string;
}

export class GroqSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "groq-whisper";
  readonly available: boolean;

  constructor(private readonly apiKey?: string, private readonly model = "whisper-large-v3-turbo") {
    this.available = Boolean(apiKey);
  }

  async transcribe(media: DownloadedMedia): Promise<TranscriptResult> {
    if (!this.apiKey) throw new Error("Groq API key is not configured");
    const form = new FormData();
    const bytes = media.data.buffer.slice(media.data.byteOffset, media.data.byteOffset + media.data.byteLength) as ArrayBuffer;
    form.append("file", new Blob([bytes], { type: media.mimeType }), "voice-note");
    form.append("model", this.model);
    form.append("response_format", "json");
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(await providerError(response, "Groq transcription"));
    const body = await response.json() as { text?: unknown; language?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) throw new Error("Transcription provider returned no text");
    return { text: body.text.trim().slice(0, 4000), confidence: 0.75, ...(typeof body.language === "string" ? { language: body.language } : {}) };
  }
}

export class ElevenLabsSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "elevenlabs-scribe";
  readonly available: boolean;

  constructor(private readonly apiKey?: string, private readonly model = "scribe_v1", private readonly apiBaseUrl = "https://api.elevenlabs.io") {
    this.available = Boolean(apiKey);
  }

  async transcribe(media: DownloadedMedia): Promise<TranscriptResult> {
    if (!this.apiKey) throw new Error("ElevenLabs API key is not configured");
    const form = new FormData();
    const bytes = media.data.buffer.slice(media.data.byteOffset, media.data.byteOffset + media.data.byteLength) as ArrayBuffer;
    form.append("file", new Blob([bytes], { type: media.mimeType }), "voice-note");
    form.append("model_id", this.model);
    form.append("tag_audio_events", "false");
    const response = await fetch(`${this.apiBaseUrl.replace(/\/$/, "")}/v1/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(await providerError(response, "ElevenLabs transcription"));
    const body = await response.json() as { text?: unknown; language_code?: unknown; language_probability?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) throw new Error("Transcription provider returned no text");
    const confidence = typeof body.language_probability === "number" && Number.isFinite(body.language_probability)
      ? Math.min(1, Math.max(0, body.language_probability))
      : 0.75;
    return { text: body.text.trim().slice(0, 4000), confidence, ...(typeof body.language_code === "string" ? { language: body.language_code } : {}) };
  }
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini-vision";
  readonly available: boolean;

  constructor(private readonly apiKey?: string, private readonly model = "gemini-3.6-flash") {
    this.available = Boolean(apiKey);
  }

  async analyze(media: DownloadedMedia, context: VisionAnalysisContext = {}): Promise<VisionResult> {
    if (!this.apiKey) throw new Error("Gemini API key is not configured");
    const mimeType = normalizeVisionMimeType(media.mimeType);
    const mediaLabel = context.messageType === "sticker" || mimeType === "image/webp" ? "WhatsApp sticker or image" : "image";
    const caption = context.caption?.trim().slice(0, 500);
    const instruction = [
      `Inspect this ${mediaLabel} as a literal visual inspection tool.`,
      "First describe only what is visibly present in the pixels: objects, people, colors, layout, and legible text.",
      "Do not invent details, identities, brands, locations, motives, or events that cannot be seen.",
      "Do not guess when the image is blurry, cropped, dark, occluded, or ambiguous; say what is unclear and lower confidence.",
      "If an animal is present, independently check cat versus dog using visible ears, muzzle, paws, fur, body shape, and tail. Only name cat or dog when at least two distinguishing features are clearly visible; otherwise use animalSpecies=unclear and describe it only as an animal.",
      "Before returning JSON, perform a second independent check of any animal species. If the two checks disagree, use animalSpecies=unclear.",
      "Treat a caption as context, never as visual evidence. Include only text that is actually legible in ocrText.",
      context.messageType === "sticker" ? "For a sticker, describe the visible character or artwork and any clearly expressed emotion, but do not assume a meme meaning." : "",
      caption ? `User caption for context only: ${caption}` : "",
      "Return only JSON with description, ocrText, confidence (0..1), animalSpecies (cat, dog, other, unclear, or none), and animalEvidence. Set confidence below 0.5 whenever the visual evidence is uncertain.",
    ].filter(Boolean).join(" ");
    const parsed = await this.requestVision(media, mimeType, instruction, "Gemini vision");
    if (!parsed) throw new Error("Vision provider returned no text");
    if (typeof parsed.description !== "string" || !parsed.description.trim()) throw new Error("Vision provider returned no description");
    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : 0.6;
    const explicitAnimal = normalizeAnimalSpecies(parsed.animalSpecies);
    const description = parsed.description.trim().slice(0, 2_000);
    const animalCandidate = explicitAnimal === "cat" || explicitAnimal === "dog" ? explicitAnimal : explicitAnimal ? undefined : animalFromDescription(description);
    const descriptionAnimal = animalFromDescription(description);
    const animalMentioned = explicitAnimal !== "none" && (Boolean(descriptionAnimal) || explicitAnimal === "cat" || explicitAnimal === "dog" || explicitAnimal === "unclear");
    if (animalCandidate) {
      const verification = await this.verifyAnimalSpecies(media, mimeType);
      if (verification?.species !== animalCandidate || verification.confidence < 0.75 || confidence < 0.75) {
        return { description: conservativeAnimalDescription(description), ...(typeof parsed.ocrText === "string" && parsed.ocrText.trim() ? { ocrText: parsed.ocrText.trim().slice(0, 2_000) } : {}), confidence: Math.min(confidence, 0.35), animalSpecies: "unclear" };
      }
    } else if (animalMentioned) {
      return { description: conservativeAnimalDescription(description), ...(typeof parsed.ocrText === "string" && parsed.ocrText.trim() ? { ocrText: parsed.ocrText.trim().slice(0, 2_000) } : {}), confidence: Math.min(confidence, 0.35), animalSpecies: "unclear" };
    }
    return { description, ...(typeof parsed.ocrText === "string" && parsed.ocrText.trim() ? { ocrText: parsed.ocrText.trim().slice(0, 2_000) } : {}), confidence, ...(explicitAnimal ? { animalSpecies: explicitAnimal } : {}) };
  }

  private async requestVision(media: DownloadedMedia, mimeType: string, instruction: string, label: string): Promise<ParsedVision | undefined> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey as string)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: instruction }, { inline_data: { mime_type: mimeType, data: media.data.toString("base64") } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(await providerError(response, label));
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? parseVisionJson(text) : undefined;
  }

  private async verifyAnimalSpecies(media: DownloadedMedia, mimeType: string): Promise<{ species: "cat" | "dog"; confidence: number } | undefined> {
    try {
      const parsed = await this.requestVision(media, mimeType, [
        "Independently verify the animal species in this image.",
        "Ignore any caption and do not rely on a previous description.",
        "Return only JSON: {\"animalSpecies\":\"cat\"|\"dog\"|\"other\"|\"unclear\",\"animalEvidence\":\"two visible distinguishing features or empty\",\"confidence\":0..1}.",
        "Use cat or dog only when at least two distinguishing features are clearly visible. Otherwise use unclear.",
      ].join(" "), "Gemini animal verification");
      const species = normalizeAnimalSpecies(parsed?.animalSpecies);
      const confidence = typeof parsed?.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : 0;
      const evidence = typeof parsed?.animalEvidence === "string" ? parsed.animalEvidence.trim() : "";
      return (species === "cat" || species === "dog") && evidence.length >= 10 ? { species, confidence } : undefined;
    } catch {
      return undefined;
    }
  }
}

function normalizeVisionMimeType(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() || "image/jpeg";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

type ParsedVision = { description?: unknown; ocrText?: unknown; confidence?: unknown; animalSpecies?: unknown; animalEvidence?: unknown };

function parseVisionJson(value: string): ParsedVision | undefined {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned) as ParsedVision;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as ParsedVision;
    } catch {
      return undefined;
    }
  }
}

function normalizeAnimalSpecies(value: unknown): "cat" | "dog" | "other" | "unclear" | "none" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^(cat|kitten|feline)$/.test(normalized)) return "cat";
  if (/^(dog|puppy|canine)$/.test(normalized)) return "dog";
  if (/^(other|animal)$/.test(normalized)) return "other";
  if (/^(unclear|unknown|uncertain|ambiguous)$/.test(normalized)) return "unclear";
  if (/^(none|no animal|not present)$/.test(normalized)) return "none";
  return undefined;
}

function animalFromDescription(description: string): "cat" | "dog" | undefined {
  if (/\b(?:cat|kitten|feline)\b/i.test(description)) return "cat";
  if (/\b(?:dog|puppy|canine)\b/i.test(description)) return "dog";
  return undefined;
}

function conservativeAnimalDescription(description: string): string {
  const withoutSpecies = description.replace(/\b(?:cat|kitten|feline|dog|puppy|canine)\b/gi, "animal").replace(/\s+/g, " ").trim();
  return `${withoutSpecies || "An animal is visible"}. The animal species is unclear, so I will not guess.`.slice(0, 2_000);
}

async function providerError(response: Response, label: string): Promise<string> {
  const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 240);
  return `${label} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
}

export class OpenAITextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "openai-tts";
  readonly available: boolean;

  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly model = "gpt-4o-mini-tts",
    private readonly voice = "alloy",
  ) {
    this.available = Boolean(apiKey);
  }

  async synthesize(text: string): Promise<DownloadedMedia> {
    if (!this.apiKey) throw new Error("TTS API key is not configured");
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, voice: this.voice, input: text.slice(0, 4000), response_format: "opus" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(await providerError(response, "TTS provider"));
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > 10 * 1024 * 1024) throw new Error("TTS audio is empty or exceeds the 10 MB limit");
    return { data, mimeType: response.headers.get("content-type")?.split(";", 1)[0] || "audio/ogg" };
  }
}

export class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "elevenlabs-tts";
  readonly available: boolean;

  constructor(
    private readonly apiKey?: string,
    private readonly voiceId = "21m00Tcm4TlvDq8ikWAM",
    private readonly model = "eleven_multilingual_v2",
    private readonly apiBaseUrl = "https://api.elevenlabs.io",
  ) {
    this.available = Boolean(apiKey);
  }

  async synthesize(text: string): Promise<DownloadedMedia> {
    if (!this.apiKey) throw new Error("ElevenLabs API key is not configured");
    const url = new URL(`${this.apiBaseUrl.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(this.voiceId)}`);
    url.searchParams.set("output_format", "opus_48000_128");
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/ogg" },
      body: JSON.stringify({ text: text.slice(0, 4000), model_id: this.model }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(await providerError(response, "ElevenLabs TTS"));
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > 10 * 1024 * 1024) throw new Error("ElevenLabs audio is empty or exceeds the 10 MB limit");
    return { data, mimeType: response.headers.get("content-type")?.split(";", 1)[0] || "audio/ogg" };
  }
}

export class FallbackTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = "tts-fallback";
  readonly available: boolean;

  constructor(private readonly providers: TextToSpeechProvider[]) {
    this.available = providers.some((provider) => provider.available);
  }

  async synthesize(text: string): Promise<DownloadedMedia> {
    let lastError: unknown;
    for (const provider of this.providers) {
      if (!provider.available) continue;
      try {
        return await provider.synthesize(text);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No TTS provider is configured");
  }
}

export class FallbackSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "speech-fallback";
  readonly available: boolean;

  constructor(private readonly providers: SpeechToTextProvider[]) {
    this.available = providers.some((provider) => provider.available);
  }

  async transcribe(media: DownloadedMedia): Promise<TranscriptResult> {
    let lastError: unknown;
    for (const provider of this.providers) {
      if (!provider.available) continue;
      try {
        return await provider.transcribe(media);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No speech provider is configured");
  }
}

export class MediaProcessor {
  private readonly cache = new Map<string, TranscriptResult>();
  private readonly visionCache = new Map<string, VisionResult>();
  private readonly downloadTimes = new Map<string, number[]>();
  private readonly activeOperations = new Map<string, MediaActivity["operations"][number]>();
  private lastActivity: Omit<MediaActivity, "active" | "operations"> = {};

  constructor(private readonly speech: SpeechToTextProvider, private readonly vision?: VisionProvider, private readonly tts?: TextToSpeechProvider, private readonly downloadsPerHour = 100) {}

  async transcribeAudio(loader: () => Promise<DownloadedMedia>, scopeId?: string): Promise<TranscriptResult> {
    return this.trackActivity("transcription", this.speech.name, async () => {
      this.reserveDownload(scopeId);
      const media = await loader();
      const hash = createHash("sha256").update(media.data).digest("hex");
      const cached = this.cache.get(hash);
      if (cached) return cached;
      const transcript = await this.speech.transcribe(media);
      this.cache.set(hash, transcript);
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
      return transcript;
    });
  }

  async analyzeImage(loader: () => Promise<DownloadedMedia>, scopeId?: string, context?: VisionAnalysisContext): Promise<VisionResult> {
    return this.trackActivity("vision", this.vision?.name ?? "none", async () => {
      if (!this.vision?.available) throw new Error("No vision provider is configured");
      this.reserveDownload(scopeId);
      const media = await loader();
      const hash = createHash("sha256").update(media.data).digest("hex");
      const cached = this.visionCache.get(hash);
      if (cached) return cached;
      const result = await this.vision.analyze(media, context);
      this.visionCache.set(hash, result);
      if (this.visionCache.size > 100) this.visionCache.delete(this.visionCache.keys().next().value as string);
      return result;
    });
  }

  async synthesizeSpeech(text: string): Promise<DownloadedMedia> {
    return this.trackActivity("text_to_speech", this.tts?.name ?? "none", async () => {
      if (!this.tts?.available) throw new Error("No TTS provider is configured");
      return this.tts.synthesize(text);
    });
  }

  async extractDocumentText(loader: () => Promise<DownloadedMedia>, scopeId?: string): Promise<DocumentTextResult> {
    this.reserveDownload(scopeId);
    const media = await loader();
    const mimeType = media.mimeType.toLowerCase();
    if (!mimeType.startsWith("text/") && !["application/json", "application/xml", "application/javascript"].includes(mimeType)) throw new Error("document_text_extraction_unsupported");
    const text = media.data.toString("utf8").replace(/\u0000/g, "").trim();
    if (!text) throw new Error("document_has_no_text");
    return { text: text.slice(0, 4000), mimeType };
  }

  health(): { speechToText: boolean; vision: boolean; textToSpeech: boolean; activity: MediaActivity } {
    return {
      speechToText: this.speech.available,
      vision: Boolean(this.vision?.available),
      textToSpeech: Boolean(this.tts?.available),
      activity: {
        active: this.activeOperations.size > 0,
        operations: [...this.activeOperations.values()],
        ...this.lastActivity,
      },
    };
  }

  private async trackActivity<T>(operation: MediaActivity["lastOperation"], provider: string, handler: () => Promise<T>): Promise<T> {
    if (!operation) return handler();
    const id = `${operation}:${Date.now()}:${Math.random()}`;
    const startedAt = Date.now();
    this.activeOperations.set(id, { operation, provider, startedAt });
    try {
      const result = await handler();
      this.lastActivity = { lastOperation: operation, lastProvider: provider, lastStatus: "succeeded", lastFinishedAt: Date.now() };
      return result;
    } catch (error) {
      this.lastActivity = {
        lastOperation: operation,
        lastProvider: provider,
        lastStatus: "failed",
        lastFinishedAt: Date.now(),
        lastError: error instanceof Error ? error.message.slice(0, 300) : "media_operation_failed",
      };
      throw error;
    } finally {
      this.activeOperations.delete(id);
    }
  }

  private reserveDownload(scopeId?: string): void {
    if (!scopeId) return;
    if (this.downloadsPerHour <= 0) throw new Error("media_download_rate_limit");
    const now = Date.now();
    const recent = (this.downloadTimes.get(scopeId) ?? []).filter((timestamp) => timestamp > now - 60 * 60 * 1000);
    if (recent.length >= this.downloadsPerHour) throw new Error("media_download_rate_limit");
    recent.push(now);
    this.downloadTimes.set(scopeId, recent);
  }
}
