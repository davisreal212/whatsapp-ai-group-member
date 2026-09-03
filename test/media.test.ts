import { describe, expect, it, vi } from "vitest";
import { ElevenLabsSpeechToTextProvider, ElevenLabsTextToSpeechProvider, FallbackSpeechToTextProvider, FallbackTextToSpeechProvider, GeminiVisionProvider, MediaProcessor, type DownloadedMedia, type SpeechToTextProvider, type TextToSpeechProvider, type VisionProvider } from "../src/media.js";

const media: DownloadedMedia = { data: Buffer.from("voice"), mimeType: "audio/ogg" };

describe("media processing", () => {
  it("falls back when the primary speech provider fails", async () => {
    const primary: SpeechToTextProvider = { name: "primary", available: true, transcribe: async () => { throw new Error("offline"); } };
    const backup: SpeechToTextProvider = { name: "backup", available: true, transcribe: async () => ({ text: "Omo abeg check am", confidence: 0.88, language: "en" }) };
    await expect(new FallbackSpeechToTextProvider([primary, backup]).transcribe(media)).resolves.toMatchObject({ text: "Omo abeg check am", confidence: 0.88 });
  });

  it("transcribes with ElevenLabs Scribe when configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ text: "I dey come", language_code: "en", language_probability: 0.94 }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(new ElevenLabsSpeechToTextProvider("test-key").transcribe(media)).resolves.toMatchObject({ text: "I dey come", language: "en", confidence: 0.94 });
      expect(fetchMock).toHaveBeenCalledWith("https://api.elevenlabs.io/v1/speech-to-text", expect.objectContaining({ method: "POST", headers: { "xi-api-key": "test-key" } }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("records the current media operation and clears it after completion", async () => {
    let release!: () => void;
    const provider: SpeechToTextProvider = {
      name: "test-speech",
      available: true,
      transcribe: async () => new Promise((resolve) => { release = () => resolve({ text: "hello", confidence: 0.9 }); }),
    };
    const processor = new MediaProcessor(provider);
    const pending = processor.transcribeAudio(async () => media);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(processor.health().activity).toMatchObject({ active: true, operations: [{ operation: "transcription", provider: "test-speech" }] });
    release();
    await pending;
    expect(processor.health().activity).toMatchObject({ active: false, lastOperation: "transcription", lastStatus: "succeeded", lastProvider: "test-speech" });
  });

  it("does not transcribe the same audio hash twice", async () => {
    let calls = 0;
    const provider: SpeechToTextProvider = { name: "test", available: true, transcribe: async () => { calls += 1; return { text: "cached", confidence: 0.9 }; } };
    const processor = new MediaProcessor(provider);
    await processor.transcribeAudio(async () => media);
    await processor.transcribeAudio(async () => ({ ...media, data: Buffer.from(media.data) }));
    expect(calls).toBe(1);
  });

  it("caches image analysis by media hash", async () => {
    let calls = 0;
    const vision: VisionProvider = { name: "test-vision", available: true, analyze: async () => { calls += 1; return { description: "A BTC chart", ocrText: "80K", confidence: 0.91 }; } };
    const processor = new MediaProcessor({ name: "unused", available: false, transcribe: async () => ({ text: "", confidence: 0 }) }, vision);
    await processor.analyzeImage(async () => ({ data: Buffer.from("image"), mimeType: "image/png" }));
    await processor.analyzeImage(async () => ({ data: Buffer.from("image"), mimeType: "image/png" }));
    expect(calls).toBe(1);
  });

  it("accepts fenced vision JSON for sticker analysis", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n{\"description\":\"laughing sticker\",\"confidence\":0.9}\n```" }] } }] }), { status: 200 }));
    try {
      await expect(new GeminiVisionProvider("test-key").analyze({ data: Buffer.from("sticker"), mimeType: "image/webp" })).resolves.toMatchObject({ description: "laughing sticker", confidence: 0.9 });
      const request = fetchMock.mock.calls[0]?.[1];
      expect(String(request?.body)).toContain("WhatsApp sticker");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("generates audio only when a TTS provider is available", async () => {
    const tts: TextToSpeechProvider = { name: "test-tts", available: true, synthesize: async () => media };
    await expect(new MediaProcessor({ name: "unused", available: false, transcribe: async () => ({ text: "", confidence: 0 }) }, undefined, tts).synthesizeSpeech("Hello"))
      .resolves.toEqual(media);
    await expect(new MediaProcessor({ name: "unused", available: false, transcribe: async () => ({ text: "", confidence: 0 }) }).synthesizeSpeech("Hello"))
      .rejects.toThrow("No TTS provider");
  });

  it("falls back to the secondary TTS provider", async () => {
    const primary: TextToSpeechProvider = { name: "primary", available: true, synthesize: async () => { throw new Error("quota"); } };
    const backup: TextToSpeechProvider = { name: "elevenlabs", available: true, synthesize: async () => media };
    await expect(new FallbackTextToSpeechProvider([primary, backup]).synthesize("Hello")).resolves.toEqual(media);
  });

  it("sends the ElevenLabs output format as a query parameter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("audio"), { status: 200, headers: { "content-type": "audio/ogg" } }));
    try {
      await new ElevenLabsTextToSpeechProvider("test-key").synthesize("Hello");
      const request = fetchMock.mock.calls[0]?.[0];
      expect(String(request)).toContain("output_format=opus_48000_128");
      expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("output_format");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("enforces a per-scope hourly media download limit", async () => {
    let downloads = 0;
    const provider: SpeechToTextProvider = { name: "test", available: true, transcribe: async () => ({ text: "cached", confidence: 0.9 }) };
    const processor = new MediaProcessor(provider, undefined, undefined, 1);
    const loader = async () => { downloads += 1; return media; };
    await processor.transcribeAudio(loader, "chat-1");
    await expect(processor.transcribeAudio(loader, "chat-1")).rejects.toThrow("media_download_rate_limit");
    expect(downloads).toBe(1);
  });

  it("extracts text documents locally and rejects binary documents", async () => {
    const processor = new MediaProcessor({ name: "unused", available: false, transcribe: async () => ({ text: "", confidence: 0 }) });
    await expect(processor.extractDocumentText(async () => ({ data: Buffer.from("hello document"), mimeType: "text/plain" }), "chat-1"))
      .resolves.toEqual({ text: "hello document", mimeType: "text/plain" });
    await expect(processor.extractDocumentText(async () => ({ data: Buffer.from("pdf"), mimeType: "application/pdf" }), "chat-2"))
      .rejects.toThrow("document_text_extraction_unsupported");
  });
});
