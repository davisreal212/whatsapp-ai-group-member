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
  analyze(media: DownloadedMedia): Promise<VisionResult>;
}

export interface TextToSpeechProvider {
  readonly name: string;
  readonly available: boolean;
  synthesize(text: string): Promise<DownloadedMedia>;
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
    if (!response.ok) throw new Error(`Groq transcription returned HTTP ${response.status}`);
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
    if (!response.ok) throw new Error(`ElevenLabs transcription returned HTTP ${response.status}`);
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

  async analyze(media: DownloadedMedia): Promise<VisionResult> {
    if (!this.apiKey) throw new Error("Gemini API key is not configured");
    const instruction = media.mimeType.toLowerCase() === "image/webp"
      ? "Describe this WhatsApp sticker or image. Explain the likely emotion, joke, meme meaning, visible objects, and any visible text. Return JSON with description, ocrText, and confidence (0..1)."
      : "Describe this image for a WhatsApp conversation. Explain the important objects, scene, intent, and visible text as OCR. Return JSON with description, ocrText, and confidence (0..1).";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: instruction }, { inline_data: { mime_type: media.mimeType, data: media.data.toString("base64") } }] }], generationConfig: { responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Gemini vision returned HTTP ${response.status}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Vision provider returned no text");
    const parsed = parseVisionJson(text);
    if (!parsed) return { description: text.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim().slice(0, 2_000), confidence: 0.5 };
    if (typeof parsed.description !== "string" || !parsed.description.trim()) throw new Error("Vision provider returned no description");
    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : 0.6;
    return { description: parsed.description.trim().slice(0, 2000), ...(typeof parsed.ocrText === "string" && parsed.ocrText.trim() ? { ocrText: parsed.ocrText.trim().slice(0, 2000) } : {}), confidence };
  }
}

function parseVisionJson(value: string): { description?: unknown; ocrText?: unknown; confidence?: unknown } | undefined {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned) as { description?: unknown; ocrText?: unknown; confidence?: unknown };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as { description?: unknown; ocrText?: unknown; confidence?: unknown };
    } catch {
      return undefined;
    }
  }
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
    if (!response.ok) throw new Error(`TTS provider returned HTTP ${response.status}`);
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
    const response = await fetch(`${this.apiBaseUrl.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(this.voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/ogg" },
      body: JSON.stringify({ text: text.slice(0, 4000), model_id: this.model, output_format: "opus_48000_128" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}`);
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

  constructor(private readonly speech: SpeechToTextProvider, private readonly vision?: VisionProvider, private readonly tts?: TextToSpeechProvider, private readonly downloadsPerHour = 100) {}

  async transcribeAudio(loader: () => Promise<DownloadedMedia>, scopeId?: string): Promise<TranscriptResult> {
    this.reserveDownload(scopeId);
    const media = await loader();
    const hash = createHash("sha256").update(media.data).digest("hex");
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const transcript = await this.speech.transcribe(media);
    this.cache.set(hash, transcript);
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
    return transcript;
  }

  async analyzeImage(loader: () => Promise<DownloadedMedia>, scopeId?: string): Promise<VisionResult> {
    if (!this.vision?.available) throw new Error("No vision provider is configured");
    this.reserveDownload(scopeId);
    const media = await loader();
    const hash = createHash("sha256").update(media.data).digest("hex");
    const cached = this.visionCache.get(hash);
    if (cached) return cached;
    const result = await this.vision.analyze(media);
    this.visionCache.set(hash, result);
    if (this.visionCache.size > 100) this.visionCache.delete(this.visionCache.keys().next().value as string);
    return result;
  }

  async synthesizeSpeech(text: string): Promise<DownloadedMedia> {
    if (!this.tts?.available) throw new Error("No TTS provider is configured");
    return this.tts.synthesize(text);
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

  health(): { speechToText: boolean; vision: boolean; textToSpeech: boolean } {
    return { speechToText: this.speech.available, vision: Boolean(this.vision?.available), textToSpeech: Boolean(this.tts?.available) };
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
