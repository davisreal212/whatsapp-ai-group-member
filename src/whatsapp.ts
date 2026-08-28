import { mkdir } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type GroupMetadata,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import type { Store } from "./store.js";
import type { OutboundTransport } from "./actions.js";
import type { ConnectionStatus } from "./types.js";

export interface DiscoveredGroup {
  id: string;
  subject: string;
  participantCount: number;
  isAdmin: boolean;
}

export interface WhatsAppEvents {
  onRawMessage(raw: WAMessage): Promise<void>;
  onGroups(groups: DiscoveredGroup[]): Promise<void>;
}

export class BaileysWhatsAppAdapter implements OutboundTransport {
  private socket?: WASocket;
  private readonly rawMessages = new Map<string, WAMessage>();
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private isOpen = false;
  private authRegistered = false;
  private pairingCodeRequested = false;

  constructor(
    private readonly authDir: string,
    private readonly store: Store,
    private readonly events: WhatsAppEvents,
  ) {}

  get connected(): boolean {
    return this.isOpen;
  }

  async connect(phoneNumber?: string): Promise<void> {
    if (this.socket) {
      if (phoneNumber && !this.authRegistered && !this.pairingCodeRequested) {
        await this.requestPairingCode(this.socket, phoneNumber);
      }
      return;
    }
    await mkdir(this.authDir, { recursive: true });
    await this.store.setConnection(this.reconnectAttempts ? "RECONNECTING" : "CONNECTING");
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.authRegistered = state.creds.registered;
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      generateHighQualityLinkPreview: false,
    });
    this.socket = socket;
    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("messages.upsert", async ({ messages }) => {
      for (const raw of messages) {
        if (raw.key.id) this.rawMessages.set(raw.key.id, raw);
        await this.events.onRawMessage(raw);
      }
    });
    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(update.connection === "open" || update.connection === "close" ? update.connection : undefined, update.lastDisconnect?.error, phoneNumber);
    });

    if (phoneNumber && !state.creds.registered) await this.requestPairingCode(socket, phoneNumber);
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.end(undefined);
    this.socket = undefined;
    this.isOpen = false;
    this.authRegistered = false;
    this.pairingCodeRequested = false;
    this.reconnectAttempts = 0;
    await this.store.setConnection("DISCONNECTED");
  }

  async listGroups(): Promise<DiscoveredGroup[]> {
    if (!this.socket) return [];
    const groups = await this.socket.groupFetchAllParticipating();
    return Object.values(groups).map((group) => toDiscoveredGroup(group, this.socket?.user?.id));
  }

  async sendText(groupId: string, text: string, quotedMessageId?: string, mentionedIds?: string[]): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp is not connected");
    const quoted = quotedMessageId ? this.rawMessages.get(quotedMessageId) : undefined;
    await this.socket.sendMessage(groupId, {
      text,
      ...(mentionedIds?.length ? { mentions: mentionedIds } : {}),
    }, quoted ? { quoted } : undefined);
  }

  async sendReaction(groupId: string, messageId: string, reaction: string): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp is not connected");
    const raw = this.rawMessages.get(messageId);
    if (!raw?.key) throw new Error("Reaction target is no longer available");
    await this.socket.sendMessage(groupId, { react: { text: reaction, key: raw.key } });
  }

  async sendMedia(groupId: string, mediaUrl: string, mimeType: string, caption?: string): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp is not connected");
    const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Media source returned HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 10 * 1024 * 1024) throw new Error("Media exceeds the 10 MB limit");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > 10 * 1024 * 1024) throw new Error("Media exceeds the 10 MB limit");
    if (mimeType.startsWith("image/")) {
      await this.socket.sendMessage(groupId, { image: body, mimetype: mimeType, ...(caption ? { caption } : {}) });
    } else if (mimeType.startsWith("audio/")) {
      await this.socket.sendMessage(groupId, { audio: body, mimetype: mimeType, ptt: true, ...(caption ? { caption } : {}) });
    } else {
      throw new Error("Unsupported media type");
    }
  }

  private async handleConnectionUpdate(
    connection: "open" | "close" | undefined,
    error: unknown,
    phoneNumber?: string,
  ): Promise<void> {
    if (connection === "open") {
      this.isOpen = true;
      this.authRegistered = true;
      this.pairingCodeRequested = false;
      this.reconnectAttempts = 0;
      await this.store.setConnection("CONNECTED");
      await this.events.onGroups(await this.listGroups());
      return;
    }
    if (connection !== "close") return;
    this.socket = undefined;
    this.isOpen = false;
    this.pairingCodeRequested = false;
    const statusCode = error && typeof error === "object" && "output" in error
      ? (error as { output?: { statusCode?: number } }).output?.statusCode
      : undefined;
    if (statusCode === DisconnectReason.loggedOut) {
      await this.store.setConnection("REQUIRES_REPAIR");
      return;
    }
    if (this.reconnectAttempts >= 5) {
      await this.store.setConnection("REQUIRES_REPAIR");
      return;
    }
    this.reconnectAttempts += 1;
    await this.store.setConnection("RECONNECTING");
    const delay = Math.min(60_000, 1_000 * 2 ** (this.reconnectAttempts - 1)) + Math.floor(Math.random() * 500);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(phoneNumber).catch(async (connectError) => {
        await this.store.addLog({
          id: crypto.randomUUID(),
          event: "whatsapp.reconnect_failure",
          level: "error",
          details: { error: connectError instanceof Error ? connectError.message : "unknown error" },
          createdAt: Date.now(),
        });
      });
    }, delay);
  }

  private async requestPairingCode(socket: WASocket, phoneNumber: string): Promise<void> {
    if (this.pairingCodeRequested) return;
    const normalized = normalizePairingPhoneNumber(phoneNumber);
    if (!normalized) throw new Error("A valid phone number is required for pairing");
    this.pairingCodeRequested = true;
    await this.store.setConnection("PAIRING");
    try {
      // Baileys pairing codes require country code digits only.
      const pairingCode = await socket.requestPairingCode(normalized);
      await this.store.setConnection("PAIRING", pairingCode);
      await this.store.addLog({
        id: crypto.randomUUID(),
        event: "whatsapp.pairing_code_created",
        level: "info",
        details: { phoneDigits: `${normalized.slice(0, 3)}***${normalized.slice(-2)}` },
        createdAt: Date.now(),
      });
    } catch (error) {
      this.pairingCodeRequested = false;
      throw error;
    }
  }
}

export function normalizePairingPhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

function toDiscoveredGroup(group: GroupMetadata, ownJid?: string): DiscoveredGroup {
  const normalizedOwnJid = ownJid?.split(":")[0];
  const self = group.participants.find((participant) => participant.id.split(":")[0] === normalizedOwnJid);
  return {
    id: group.id,
    subject: group.subject,
    participantCount: group.participants.length,
    isAdmin: self?.admin === "admin" || self?.admin === "superadmin",
  };
}
