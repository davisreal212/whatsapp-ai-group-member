export interface ElevenLabsWhatsAppCallConfig {
  apiKey?: string;
  agentId?: string;
  apiBaseUrl: string;
  whatsappPhoneNumberId?: string;
  permissionTemplateName?: string;
  permissionTemplateLanguageCode?: string;
}

export interface ElevenLabsCallResult {
  success: boolean;
  message: string;
  conversationId?: string;
}

export interface ElevenLabsCallStatus {
  available: boolean;
  missing: string[];
}

export class ElevenLabsWhatsAppCallService {
  readonly available: boolean;

  constructor(private readonly config: ElevenLabsWhatsAppCallConfig) {
    this.available = this.status().available;
  }

  status(): ElevenLabsCallStatus {
    const fields: Array<[string, string | undefined]> = [
      ["ELEVENLABS_API_KEY", this.config.apiKey],
      ["ELEVENLABS_AGENT_ID", this.config.agentId],
      ["ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID", this.config.whatsappPhoneNumberId],
      ["ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME", this.config.permissionTemplateName],
      ["ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE_CODE", this.config.permissionTemplateLanguageCode],
    ];
    const missing = fields.filter(([, value]) => !value).map(([name]) => name);
    return { available: missing.length === 0, missing };
  }

  async startCall(whatsappUserId: string): Promise<ElevenLabsCallResult> {
    if (!this.available) throw new Error("ElevenLabs WhatsApp voice calling is not fully configured");
    const response = await fetch(`${this.config.apiBaseUrl.replace(/\/$/, "")}/v1/convai/whatsapp/outbound-call`, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": this.config.apiKey as string },
      body: JSON.stringify({
        whatsapp_phone_number_id: this.config.whatsappPhoneNumberId,
        whatsapp_user_id: whatsappUserId,
        whatsapp_call_permission_request_template_name: this.config.permissionTemplateName,
        whatsapp_call_permission_request_template_language_code: this.config.permissionTemplateLanguageCode,
        agent_id: this.config.agentId,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 240);
      throw new Error(`ElevenLabs WhatsApp call returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const body = await response.json() as { success?: unknown; message?: unknown; conversation_id?: unknown };
    if (body.success !== true) throw new Error(typeof body.message === "string" ? body.message : "ElevenLabs WhatsApp call was not started");
    return {
      success: true,
      message: typeof body.message === "string" ? body.message : "WhatsApp voice call started",
      ...(typeof body.conversation_id === "string" ? { conversationId: body.conversation_id } : {}),
    };
  }
}

export function parseVoiceCallCommand(text: string): boolean {
  return /^(?:please\s+)?(?:call me(?: now)?|voice call(?: me)?|start(?: a)? voice call|talk to me by voice|call)$/i.test(text.trim().replace(/[.!?]+$/, ""))
    || /^(?:can|could|would)\s+you(?:\s+please)?\s+call me(?: now)?$/i.test(text.trim().replace(/[.!?]+$/, ""));
}
