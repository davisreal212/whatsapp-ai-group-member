import type { CanonicalMessage, MediaMetadata, MessageType } from "./types.js";

export interface WhatsAppRawMessage {
  key?: {
    remoteJid?: string | null;
    id?: string | null;
    participant?: string | null;
    senderPn?: string | null;
    participantPn?: string | null;
    fromMe?: boolean | null;
  };
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | { low?: number } | null;
  pushName?: string | null;
}

type MessageContent = Record<string, unknown>;

const unwrapMessage = (message: MessageContent): MessageContent => {
  for (const key of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage"]) {
    const nested = message[key];
    if (nested && typeof nested === "object" && "message" in nested) {
      return unwrapMessage((nested as { message: MessageContent }).message);
    }
  }
  return message;
};

const asString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

const timestampMs = (value: WhatsAppRawMessage["messageTimestamp"]): number => {
  const seconds = typeof value === "number" ? value : typeof value === "object" && value ? value.low : undefined;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : Date.now();
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === "object" && "low" in value && typeof value.low === "number") return value.low;
  return undefined;
};

export function normalizeMessage(raw: WhatsAppRawMessage, botJid?: string): CanonicalMessage | undefined {
  const chatId = raw.key?.remoteJid ?? undefined;
  const id = raw.key?.id ?? undefined;
  if (!chatId || !id || !raw.message) return undefined;

  const message = unwrapMessage(raw.message);
  const entries = Object.entries(message);
  const [kind, value] = entries.find(([key]) => key !== "messageContextInfo") ?? [];
  const payload = value && typeof value === "object" ? (value as MessageContent) : {};
  const contextInfo = payload.contextInfo && typeof payload.contextInfo === "object"
    ? (payload.contextInfo as MessageContent)
    : {};
  const senderId = raw.key?.participant ?? chatId;
  const senderPhone = raw.key?.senderPn ?? raw.key?.participantPn;
  const group = chatId.endsWith("@g.us");
  const status = chatId === "status@broadcast";
  const mentions = Array.isArray(contextInfo.mentionedJid)
    ? contextInfo.mentionedJid.filter((item): item is string => typeof item === "string")
    : [];
  const quotedMessageId = asString(contextInfo.stanzaId);
  const quotedSenderId = asString(contextInfo.participant);
  const text = asString(message.conversation)
    ?? asString((message.extendedTextMessage as MessageContent | undefined)?.text)
    ?? asString(payload.caption)
    ?? asString((message.buttonsMessage as MessageContent | undefined)?.contentText)
    ?? asString((message.listMessage as MessageContent | undefined)?.description)
    ?? asString((message.templateMessage as MessageContent | undefined)?.hydratedTemplate && ((message.templateMessage as MessageContent).hydratedTemplate as MessageContent).hydratedContentText)
    ?? asString((message.interactiveMessage as MessageContent | undefined)?.body && ((message.interactiveMessage as MessageContent).body as MessageContent).text)
    ?? asString((message.contactMessage as MessageContent | undefined)?.displayName)
    ?? asString((message.locationMessage as MessageContent | undefined)?.name)
    ?? asString((message.buttonsResponseMessage as MessageContent | undefined)?.selectedDisplayText)
    ?? asString((message.listResponseMessage as MessageContent | undefined)?.title);

  const messageType = toMessageType(kind);
  const media = mediaMetadata(messageType, payload);
  const isFromBot = raw.key?.fromMe === true || (botJid !== undefined && senderId === botJid);

  return {
    id,
    chatId,
    ...(group ? { groupId: chatId } : {}),
    senderId,
    ...(senderPhone ? { senderPhone } : {}),
    ...(raw.pushName ? { senderName: raw.pushName } : {}),
    timestamp: timestampMs(raw.messageTimestamp),
    type: messageType,
    ...(text ? { text } : {}),
    ...(quotedMessageId ? { quotedMessageId } : {}),
    ...(quotedSenderId ? { quotedSenderId } : {}),
    mentionedIds: mentions,
    ...(media ? { media } : {}),
    isGroup: group,
    isStatus: status,
    isFromBot,
  };
}

function toMessageType(kind: string | undefined): MessageType {
  switch (kind) {
    case "conversation":
    case "extendedTextMessage":
    case "buttonsMessage":
    case "listMessage":
    case "templateMessage":
    case "interactiveMessage":
    case "interactiveResponseMessage":
    case "nativeFlowResponseMessage":
    case "contactMessage":
    case "contactsArrayMessage":
    case "locationMessage":
    case "liveLocationMessage":
    case "pollCreationMessage":
    case "pollUpdateMessage":
    case "orderMessage":
    case "productMessage":
    case "groupInviteMessage":
    case "eventMessage":
    case "requestPhoneNumberMessage":
    case "buttonsResponseMessage":
    case "listResponseMessage":
      return "text";
    case "imageMessage":
      return "image";
    case "videoMessage":
      return "video";
    case "audioMessage":
      return "audio";
    case "documentMessage":
      return "document";
    case "stickerMessage":
      return "sticker";
    case "reactionMessage":
      return "reaction";
    default:
      return "unknown";
  }
}

function mediaMetadata(type: MessageType, payload: MessageContent): MediaMetadata | undefined {
  if (["text", "unknown", "reaction"].includes(type)) return undefined;
  const fileLength = numberValue(payload.fileLength);
  const durationSeconds = numberValue(payload.seconds);
  return {
    ...(typeof payload.mimetype === "string" ? { mimeType: payload.mimetype } : {}),
    ...(fileLength !== undefined ? { fileLength } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(typeof payload.caption === "string" ? { caption: payload.caption } : {}),
    hasDownloadableContent: Boolean(payload.mediaKey || payload.directPath),
  };
}
