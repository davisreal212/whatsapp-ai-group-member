import { mkdir, rm } from "node:fs/promises";
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
import { fetchSafeMedia } from "./network.js";

export interface DiscoveredGroup {
  id: string;
  subject: string;
  participantCount: number;
  isAdmin: boolean;
}

export interface DiscoveredDirectMessage {
  id: string;
  displayName?: string;
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
  private pairingCodeRequest?: Promise<void>;
  private pairingPhoneNumber?: string;
  private credentialsSave = Promise.resolve();
  private manuallyDisconnected = false;

  constructor(
    private readonly authDir: string,
    private readonly store: Store,
    private readonly events: WhatsAppEvents,
  ) {}

  get connected(): boolean {
    return this.isOpen;
  }

  async connect(phoneNumber?: string): Promise<void> {
    const normalizedPhoneNumber = phoneNumber ? normalizePairingPhoneNumber(phoneNumber) : undefined;
    if (phoneNumber && !normalizedPhoneNumber) throw new Error("A valid phone number is required for pairing");
    if (normalizedPhoneNumber) this.pairingPhoneNumber = normalizedPhoneNumber;
    this.manuallyDisconnected = false;

    if (this.socket) {
      if (this.pairingPhoneNumber && !this.authRegistered) {
        await this.requestPairingCode(this.socket, this.pairingPhoneNumber);
      }
      return;
    }
    await mkdir(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.authRegistered = state.creds.registered;
    console.log(`[whatsapp] auth loaded registered=${this.authRegistered} pairingRequested=${Boolean(this.pairingPhoneNumber)}`);
    if (!this.authRegistered && !this.pairingPhoneNumber) {
      // An unfinished pairing attempt leaves a temporary `me` value in auth state.
      // Do not let the next boot treat that stale value as a logged-in session.
      if (state.creds.me || state.creds.pairingCode) {
        delete state.creds.me;
        delete state.creds.pairingCode;
        await saveCreds();
      }
      await this.store.setConnection("DISCONNECTED");
      return;
    }
    await this.store.setConnection(this.reconnectAttempts ? "RECONNECTING" : "CONNECTING");
    this.credentialsSave = Promise.resolve();
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
    socket.ev.on("creds.update", () => {
      this.credentialsSave = this.credentialsSave.then(() => saveCreds());
    });
    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      console.log(`[whatsapp] messages.upsert type=${type} count=${messages.length}`);
      for (const raw of messages) {
        if (raw.key.id) this.rawMessages.set(raw.key.id, raw);
        try {
          await this.events.onRawMessage(raw);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          console.error(`[whatsapp] message handler failed id=${raw.key.id ?? "unknown"}: ${message}`);
          await this.store.addLog({
            id: crypto.randomUUID(),
            event: "whatsapp.message_handler_failure",
            level: "error",
            details: { error: message },
            createdAt: Date.now(),
          });
        }
      }
    });
    socket.ev.on("connection.update", (update) => {
      console.log(`[whatsapp] connection.update connection=${update.connection ?? "pending"} isNewLogin=${Boolean(update.isNewLogin)} hasQr=${Boolean(update.qr)} statusCode=${getDisconnectStatusCode(update.lastDisconnect?.error) ?? "none"}`);
      if (update.isNewLogin) void this.handleNewLogin(socket);
      void this.handleConnectionUpdate(socket, update.connection === "open" || update.connection === "close" ? update.connection : undefined, update.lastDisconnect?.error).catch((error) => {
        console.error(`[whatsapp] connection handler failed: ${error instanceof Error ? error.message : "unknown"}`);
      });
    });

    if (this.pairingPhoneNumber && !state.creds.registered) await this.requestPairingCode(socket, this.pairingPhoneNumber);
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.manuallyDisconnected = true;
    const socket = this.socket;
    const wasConnected = this.isOpen && this.authRegistered;
    this.socket = undefined;
    this.isOpen = false;
    this.authRegistered = false;
    this.pairingCodeRequest = undefined;
    this.pairingPhoneNumber = undefined;
    this.rawMessages.clear();
    let logoutError: string | undefined;
    if (socket) {
      try {
        if (wasConnected) await socket.logout();
        else socket.end(undefined);
      } catch (error) {
        logoutError = error instanceof Error ? error.message : "unknown error";
        socket.end(undefined);
      }
    }
    await this.clearAuthState();
    this.reconnectAttempts = 0;
    await this.store.setConnection("DISCONNECTED");
    if (logoutError) {
      await this.store.addLog({
        id: crypto.randomUUID(),
        event: "whatsapp.logout_failure",
        level: "error",
        details: { error: logoutError },
        createdAt: Date.now(),
      });
    }
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.manuallyDisconnected = true;
    const socket = this.socket;
    this.socket = undefined;
    this.isOpen = false;
    this.authRegistered = false;
    this.pairingCodeRequest = undefined;
    this.pairingPhoneNumber = undefined;
    this.rawMessages.clear();
    socket?.end(undefined);
    await this.credentialsSave.catch(() => undefined);
    await this.store.setConnection("DISCONNECTED");
  }

  async listGroups(): Promise<DiscoveredGroup[]> {
    if (!this.socket) return [];
    const groups = await this.socket.groupFetchAllParticipating();
    return Object.values(groups).map((group) => toDiscoveredGroup(group, this.socket?.user?.id));
  }

  listDirectMessages(): DiscoveredDirectMessage[] {
    const contacts = new Map<string, DiscoveredDirectMessage>();
    for (const raw of this.rawMessages.values()) {
      const id = raw.key.remoteJid;
      if (!id || !id.endsWith("@s.whatsapp.net") || raw.key.fromMe) continue;
      const pushName = (raw as WAMessage & { pushName?: string }).pushName;
      contacts.set(id, { id, ...(pushName ? { displayName: pushName } : {}) });
    }
    return [...contacts.values()].sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id));
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
    const response = await fetchSafeMedia(mediaUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Media source returned HTTP ${response.status}`);
    const responseMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const expectedKind = mimeType.split("/", 1)[0]?.toLowerCase();
    if (responseMimeType && expectedKind && !responseMimeType.startsWith(`${expectedKind}/`)) throw new Error("Media content type does not match the requested action");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (!Number.isFinite(length) || length < 0 || length > 10 * 1024 * 1024) throw new Error("Media exceeds the 10 MB limit");
    const body = await readResponseBody(response, 10 * 1024 * 1024);
    if (mimeType.startsWith("image/")) {
      await this.socket.sendMessage(groupId, { image: body, mimetype: mimeType, ...(caption ? { caption } : {}) });
    } else if (mimeType.startsWith("audio/")) {
      await this.socket.sendMessage(groupId, { audio: body, mimetype: mimeType, ptt: true, ...(caption ? { caption } : {}) });
    } else {
      throw new Error("Unsupported media type");
    }
  }

  private async handleConnectionUpdate(
    socket: WASocket,
    connection: "open" | "close" | undefined,
    error: unknown,
  ): Promise<void> {
    if (this.socket !== socket) return;
    if (connection === "open") {
      console.log("[whatsapp] connection opened");
      this.isOpen = true;
      this.authRegistered = true;
      this.reconnectAttempts = 0;
      await this.store.setConnection("CONNECTED");
      await this.events.onGroups(await this.listGroups());
      return;
    }
    if (connection !== "close") return;
    const statusCode = getDisconnectStatusCode(error);
    console.error(`[whatsapp] connection closed statusCode=${statusCode ?? "none"} reconnectAttempt=${this.reconnectAttempts + 1}`);
    this.socket = undefined;
    this.isOpen = false;
    this.pairingCodeRequest = undefined;
    if (this.manuallyDisconnected) return;
    if (statusCode === DisconnectReason.loggedOut) {
      this.authRegistered = false;
      this.pairingPhoneNumber = undefined;
      this.rawMessages.clear();
      await this.clearAuthState();
      await this.store.setConnection("REQUIRES_REPAIR");
      await this.store.addLog({
        id: crypto.randomUUID(),
        event: "whatsapp.session_unlinked",
        level: "warn",
        details: { reason: "whatsapp_logged_out" },
        createdAt: Date.now(),
      });
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
      void this.connect(this.pairingPhoneNumber).catch(async (connectError) => {
        console.error(`[whatsapp] reconnect failed: ${connectError instanceof Error ? connectError.message : "unknown"}`);
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

  private async handleNewLogin(socket: WASocket): Promise<void> {
    try {
      // Baileys emits isNewLogin before it can use the newly saved credentials.
      await this.credentialsSave;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (this.socket === socket && !this.manuallyDisconnected) socket.end(undefined);
    } catch (error) {
      await this.store.addLog({
        id: crypto.randomUUID(),
        event: "whatsapp.pairing_restart_failure",
        level: "error",
        details: { error: error instanceof Error ? error.message : "unknown error" },
        createdAt: Date.now(),
      });
    }
  }

  private async requestPairingCode(socket: WASocket, phoneNumber: string): Promise<void> {
    const normalized = normalizePairingPhoneNumber(phoneNumber);
    if (!normalized) throw new Error("A valid phone number is required for pairing");
    if (this.pairingCodeRequest) return this.pairingCodeRequest;

    const request = (async () => {
      await this.store.setConnection("PAIRING");
      // The WebSocket must finish the Noise handshake before requestPairingCode can send data.
      await socket.waitForSocketOpen();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (this.socket !== socket) throw new Error("WhatsApp connection closed before pairing code was created");
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
    })();
    this.pairingCodeRequest = request;
    try {
      await request;
    } finally {
      if (this.pairingCodeRequest === request) this.pairingCodeRequest = undefined;
    }
  }

  private async clearAuthState(): Promise<void> {
    await this.credentialsSave.catch(() => undefined);
    await rm(this.authDir, { recursive: true, force: true });
  }
}

function getDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("output" in error)) return undefined;
  return (error as { output?: { statusCode?: number } }).output?.statusCode;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > maxBytes) throw new Error("Media exceeds the 10 MB limit");
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Media exceeds the 10 MB limit");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
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
