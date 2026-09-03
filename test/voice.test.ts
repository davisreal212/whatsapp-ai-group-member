import { describe, expect, it, vi } from "vitest";
import { sendAudioWithFallback } from "../src/whatsapp.js";
import { ElevenLabsWhatsAppCallService, parseVoiceCallCommand } from "../src/voice.js";

describe("voice features", () => {
  it("uses the configured ElevenLabs agent for WhatsApp calls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, message: "started", conversation_id: "conversation-1" }), { status: 200 }));
    try {
      const service = new ElevenLabsWhatsAppCallService({
        apiKey: "test-key",
        agentId: "configured-agent",
        apiBaseUrl: "https://elevenlabs.test",
        whatsappPhoneNumberId: "phone-number-id",
        permissionTemplateName: "call_permission",
        permissionTemplateLanguageCode: "en_US",
      });
      await expect(service.startCall("2348000000000")).resolves.toMatchObject({ success: true, conversationId: "conversation-1" });
      expect(fetchMock).toHaveBeenCalledWith("https://elevenlabs.test/v1/convai/whatsapp/outbound-call", expect.objectContaining({
        headers: { "content-type": "application/json", "xi-api-key": "test-key" },
        body: expect.stringContaining('"agent_id":"configured-agent"'),
      }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("recognizes explicit voice call requests only", () => {
    expect(parseVoiceCallCommand("call me")).toBe(true);
    expect(parseVoiceCallCommand("Can you please call me now?")).toBe(true);
    expect(parseVoiceCallCommand("start a voice call")).toBe(true);
    expect(parseVoiceCallCommand("I had a call earlier")).toBe(false);
  });

  it("reports exactly which call settings are missing", () => {
    const service = new ElevenLabsWhatsAppCallService({ apiKey: "test-key", apiBaseUrl: "https://elevenlabs.test" });
    expect(service.status()).toEqual({
      available: false,
      missing: [
        "ELEVENLABS_AGENT_ID",
        "ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID",
        "ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME",
        "ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE_CODE",
      ],
    });
  });

  it("falls back from voice-note mode to regular audio", async () => {
    const attempts: string[] = [];
    await sendAudioWithFallback(async () => { attempts.push("voice-note"); throw new Error("voice note unsupported"); }, async () => { attempts.push("audio"); });
    expect(attempts).toEqual(["voice-note", "audio"]);
  });
});
