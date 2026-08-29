import { describe, expect, it } from "vitest";
import { FallbackSpeechToTextProvider, MediaProcessor, type DownloadedMedia, type SpeechToTextProvider, type VisionProvider } from "../src/media.js";

const media: DownloadedMedia = { data: Buffer.from("voice"), mimeType: "audio/ogg" };

describe("media processing", () => {
  it("falls back when the primary speech provider fails", async () => {
    const primary: SpeechToTextProvider = { name: "primary", available: true, transcribe: async () => { throw new Error("offline"); } };
    const backup: SpeechToTextProvider = { name: "backup", available: true, transcribe: async () => ({ text: "Omo abeg check am", confidence: 0.88, language: "en" }) };
    await expect(new FallbackSpeechToTextProvider([primary, backup]).transcribe(media)).resolves.toMatchObject({ text: "Omo abeg check am", confidence: 0.88 });
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
});
