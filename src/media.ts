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
    form.append("language", "en");
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

export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini-vision";
  readonly available: boolean;

  constructor(private readonly apiKey?: string, private readonly model = "gemini-3.6-flash") {
    this.available = Boolean(apiKey);
  }

  async analyze(media: DownloadedMedia): Promise<VisionResult> {
    if (!this.apiKey) throw new Error("Gemini API key is not configured");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Describe this image for a WhatsApp conversation. Extract any visible text as OCR. Return JSON with description, ocrText, and confidence (0..1)." }, { inline_data: { mime_type: media.mimeType, data: media.data.toString("base64") } }] }], generationConfig: { responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Gemini vision returned HTTP ${response.status}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Vision provider returned no text");
    const parsed = JSON.parse(text) as { description?: unknown; ocrText?: unknown; confidence?: unknown };
    if (typeof parsed.description !== "string" || !parsed.description.trim()) throw new Error("Vision provider returned no description");
    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : 0.6;
    return { description: parsed.description.trim().slice(0, 2000), ...(typeof parsed.ocrText === "string" && parsed.ocrText.trim() ? { ocrText: parsed.ocrText.trim().slice(0, 2000) } : {}), confidence };
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

  constructor(private readonly speech: SpeechToTextProvider, private readonly vision?: VisionProvider) {}

  async transcribeAudio(loader: () => Promise<DownloadedMedia>): Promise<TranscriptResult> {
    const media = await loader();
    const hash = createHash("sha256").update(media.data).digest("hex");
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const transcript = await this.speech.transcribe(media);
    this.cache.set(hash, transcript);
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
    return transcript;
  }

  async analyzeImage(loader: () => Promise<DownloadedMedia>): Promise<VisionResult> {
    if (!this.vision?.available) throw new Error("No vision provider is configured");
    const media = await loader();
    const hash = createHash("sha256").update(media.data).digest("hex");
    const cached = this.visionCache.get(hash);
    if (cached) return cached;
    const result = await this.vision.analyze(media);
    this.visionCache.set(hash, result);
    if (this.visionCache.size > 100) this.visionCache.delete(this.visionCache.keys().next().value as string);
    return result;
  }
}
