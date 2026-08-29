# Chapter 14 — WHATSAPP CONNECTION, LINKING & SESSION MANAGEMENT

## 14.1 Purpose

The website must provide a simple way for the administrator to connect a WhatsApp account to the AI system.

The intended experience is:

Website
   ↓
Connect WhatsApp
   ↓
Enter phone number
   ↓
Generate pairing code
   ↓
Open WhatsApp
   ↓
Linked Devices
   ↓
Link a device using phone number
   ↓
Enter pairing code
   ↓
Connected

The bot should then maintain the WhatsApp session without requiring the administrator to repeat the linking process every time the server restarts.

---

## 14.2 Important Architecture Decision

The application should use a WhatsApp integration layer that supports the required features rather than coupling the entire application directly to one implementation.

Create:

WhatsApp Adapter

with a standard internal interface.

Example:

interface WhatsAppAdapter {
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  getConnectionStatus(): Promise<ConnectionStatus>;

  requestPairingCode(phoneNumber: string): Promise<string>;

  getChats(): Promise<Chat[]>;

  getGroups(): Promise<Group[]>;

  sendMessage(chatId: string, message: MessagePayload): Promise<SentMessage>;

  replyToMessage(
    chatId: string,
    messageId: string,
    message: MessagePayload
  ): Promise<SentMessage>;

  reactToMessage(
    chatId: string,
    messageId: string,
    reaction: string
  ): Promise<void>;

  downloadMedia(
    messageId: string
  ): Promise<MediaFile>;

  disconnect(): Promise<void>;
}

The rest of the AI system should communicate with this interface.

This means:

AI Brain
   ↓
WhatsApp Adapter
   ↓
WhatsApp Implementation

rather than:

AI Brain
   ↓
WhatsApp-specific code everywhere

---

## 14.3 Connection Dashboard

The website should have a dedicated:

WhatsApp

page.

Example:

┌───────────────────────────────────┐
│ WhatsApp Connection               │
│                                   │
│ Status: ● Disconnected            │
│                                   │
│ Phone Number                      │
│ +234 _____________                │
│                                   │
│ [ Generate Pairing Code ]         │
└───────────────────────────────────┘

After generating:

┌───────────────────────────────────┐
│ Pairing Code                      │
│                                   │
│        A7K9-P2LM                  │
│                                   │
│ Open WhatsApp → Settings          │
│ → Linked Devices → Link Device    │
│ → Enter this code                 │
│                                   │
│ Waiting for connection...         │
└───────────────────────────────────┘

The UI should update automatically when the connection succeeds.

---

## 14.4 Connection States

Use explicit states:

DISCONNECTED
CONNECTING
WAITING_FOR_PAIRING
AUTHENTICATING
CONNECTED
RECONNECTING
LOGGED_OUT
ERROR

Dashboard:

● Connected

or:

● Waiting for pairing

---

## 14.5 Session Persistence

The WhatsApp session must survive:

Server restart
Application restart
Worker restart
Temporary network failure

Store the authentication/session state using secure persistent storage appropriate for the chosen WhatsApp implementation.

Do NOT put session credentials into:

frontend JavaScript
public GitHub repository
client-side localStorage

---

## 14.6 Session Security

Session credentials should be treated like passwords.

Never log:

session keys
authentication tokens
private credentials

to normal application logs.

Dashboard logs should display:

Connected
Disconnected
Reconnected

rather than sensitive authentication material.

---

## 14.7 Automatic Reconnection

If WhatsApp disconnects:

CONNECTED
   ↓
NETWORK FAILURE
   ↓
RECONNECTING
   ↓
CONNECTED

Use exponential backoff.

Example:

1st attempt → 2 sec
2nd → 5 sec
3rd → 10 sec
4th → 30 sec
5th → 60 sec

Do not reconnect aggressively forever.

---

## 14.8 Connection Health

Dashboard:

WhatsApp Health

Connection:
Healthy

Connected:
12 minutes

Last received message:
14 sec ago

Last sent message:
28 sec ago

Reconnects:
1

This helps identify whether the bot is actually alive.

---

## 14.9 Incoming Message Event

Every incoming WhatsApp message should be normalized.

Example:

interface IncomingMessage {
  id: string;

  chatId: string;

  senderId: string;

  senderName?: string;

  timestamp: number;

  type:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "sticker"
    | "document"
    | "location"
    | "other";

  text?: string;

  quotedMessageId?: string;

  mentionedIds?: string[];

  media?: MediaMetadata;

  isGroup: boolean;
}

The AI system should only work with this normalized format.

---

## 14.10 Group Detection

The adapter must determine whether the message belongs to:

GROUP

or:

PRIVATE_CHAT

This distinction is extremely important.

The bot should never accidentally assume that every WhatsApp conversation is an authorized group.

---

## 14.11 Group-Only Mode

The main configuration should include:

Operating Mode

● Groups Only
○ Groups + Approved DMs
○ All Chats

Default:

Groups Only

For the requested system, this should be the safest default.

---

## 14.12 DM Protection

If the bot receives:

Private message from unknown person

and the system is configured for group-only operation:

IGNORE

It should not answer.

Even if the message says:

@AI hello

the group-only rule remains stronger.

---

## 14.13 Approved DM Mode

If DM functionality is enabled later, it should require explicit configuration.

Example:

DM Access

[ OFF ]

Approved users:
+234...
+234...

This prevents random people from using the AI through the linked WhatsApp account.

---

## 14.14 Group Authorization

The system needs an allowlist.

Example:

AUTHORIZED GROUPS

☑ Crypto Boys
☑ AI Builders
☐ Family Group
☐ School Group

Only enabled groups can activate the AI.

---

## 14.15 Group ID, Not Group Name

Do not rely only on:

"Crypto Boys"

because group names can change.

Store the platform's stable group/chat identifier.

Example:

groupId:
123456789@g.us

The display name is only for the dashboard.

---

## 14.16 New Group Detection

When a new group appears:

New group detected

Default:

AI = DISABLED

Dashboard:

New group found:

"New Group"

[ Enable AI ]

This prevents accidental participation.

---

## 14.17 Group Configuration

Each group should have independent settings.

Example:

GROUP SETTINGS

Group:
Crypto Boys

AI:
ON

Learning:
ON

Web Search:
ON

Voice:
ON

Media:
ON

Talkativeness:
Medium

Personality:
Funny / Casual

Mention All:
OFF

DM:
OFF

---

## 14.18 Group Pause

Provide:

[ PAUSE AI ]

When paused:

Messages still received
Learning optionally paused
No AI responses
No scheduled conversational actions

The administrator should be able to resume later.

---

## 14.19 Emergency Stop

The dashboard should have:

STOP ALL AI

This immediately prevents new outbound AI actions.

The WhatsApp connection itself does not necessarily need to disconnect.

---

## 14.20 Message Queue

Incoming messages should enter a queue:

WhatsApp
   ↓
Message Queue
   ↓
Processor
   ↓
AI Brain

This prevents multiple incoming messages from overwhelming the application.

---

## 14.21 Group Conversation Buffer

The processor should temporarily buffer rapidly arriving messages.

Example:

John:
Guy

David:
What?

John:
Look at this

John:
😂

Instead of treating every message as a separate AI conversation, the system can create a short context window.

---

## 14.22 Message Deduplication

Messages must be processed exactly once where possible.

Store:

messageId
processedAt
processingStatus

If the same event is delivered twice:

Already processed
→ Ignore duplicate

---

## 14.23 Message Processing States

RECEIVED
QUEUED
PROCESSING
PROCESSED
IGNORED
FAILED
RETRYING

This makes the system observable.

---

## 14.24 Outbound Queue

Do not immediately send every response directly from the AI worker.

Use:

AI
 ↓
Outbound Queue
 ↓
WhatsApp Sender
 ↓
WhatsApp

This gives control over:

- Rate limits.
- Delays.
- Retries.
- Ordering.
- Duplicate prevention.

---

## 14.25 Reply-to-Message

The outbound system must support actual WhatsApp replies.

Internal action:

{
  type: "REPLY",
  chatId: "...",
  messageId: "...",
  text: "Omo 😂 that's wild."
}

The WhatsApp adapter converts this into a platform-specific quoted reply.

---

## 14.26 Reactions

Support:

👍
😂
❤️
🤣
😮
🔥

The AI can decide:

REACT

instead of sending text.

---

## 14.27 Mentions

The system should distinguish:

Plain text:
"@John"

from:

Actual platform mention:
participant ID = John's WhatsApp ID

The second should be used when the AI intentionally tags someone.

---

## 14.28 Chapter 14 Acceptance Criteria

☐ Phone-number pairing flow
☐ Pairing-code UI
☐ Connection status
☐ Persistent session
☐ Automatic reconnection
☐ Secure authentication storage
☐ Group detection
☐ DM detection
☐ Group allowlist
☐ Group-only default
☐ Group-specific configuration
☐ Group pause
☐ Global emergency stop
☐ Incoming message queue
☐ Message deduplication
☐ Outbound queue
☐ Reply-to-message
☐ Reactions
☐ Mentions
☐ Connection health monitoring

---

