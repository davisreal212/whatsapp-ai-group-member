# Chapter 3 — WHATSAPP CONNECTION, PAIRING & SESSION MANAGEMENT

## 3.1 Purpose

This chapter implements the connection between the web dashboard and the WhatsApp account.

The administrator must be able to:

1. Log into the dashboard.
2. Enter the WhatsApp phone number.
3. Request a pairing code.
4. Enter that code into WhatsApp's Linked Devices flow.
5. See the connection status change in real time.
6. Keep the WhatsApp session alive after restarting the server.
7. Disconnect/reconnect the account from the dashboard.
8. Discover the groups belonging to the connected account.

The WhatsApp integration should be isolated behind an adapter so that the rest of the application does not depend directly on the WhatsApp library.

---

## 3.2 WhatsApp Adapter

Create a dedicated interface.

interface WhatsAppAdapter {
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  requestPairingCode(phoneNumber: string): Promise<string>;

  getConnectionState(): ConnectionState;

  getGroups(): Promise<WhatsAppGroup[]>;

  getGroupMembers(groupId: string): Promise<WhatsAppMember[]>;

  sendMessage(
    groupId: string,
    message: OutboundMessage
  ): Promise<SendResult>;

  sendReply(
    groupId: string,
    messageId: string,
    message: OutboundMessage
  ): Promise<SendResult>;

  sendReaction(
    groupId: string,
    messageId: string,
    reaction: string
  ): Promise<SendResult>;

  sendImage(
    groupId: string,
    media: MediaPayload,
    caption?: string
  ): Promise<SendResult>;

  sendAudio(
    groupId: string,
    media: MediaPayload
  ): Promise<SendResult>;

  onMessage(
    handler: (event: WhatsAppRawEvent) => Promise<void>
  ): void;
}

The implementation behind this interface can use the selected unofficial WhatsApp Web/linked-device library.

Do not spread library-specific functions throughout the application.

---

## 3.3 Connection States

The system should recognize explicit states.

DISCONNECTED
CONNECTING
WAITING_FOR_PAIRING
PAIRING
CONNECTED
RECONNECTING
LOGGED_OUT
ERROR

The dashboard should show the current state.

Example:

WhatsApp

🟢 CONNECTED

or:

WhatsApp

🟡 WAITING FOR PAIRING

or:

WhatsApp

🔴 DISCONNECTED

---

## 3.4 Pairing Flow

The dashboard flow should be:

Login
  ↓
Dashboard
  ↓
WhatsApp
  ↓
Enter phone number
  ↓
Generate pairing code
  ↓
Display code
  ↓
User opens WhatsApp
  ↓
Linked Devices
  ↓
Link with phone number
  ↓
Enter pairing code
  ↓
WhatsApp confirms device
  ↓
Backend receives connection event
  ↓
Dashboard changes to CONNECTED

The pairing code should never be stored permanently.

It should exist only for the duration required by the pairing process.

---

## 3.5 Pairing Page

The UI should look approximately like:

┌──────────────────────────────────────┐
│         CONNECT WHATSAPP             │
│                                      │
│  Phone Number                        │
│  ┌────────────────────────────────┐  │
│  │ +234 8012345678                │  │
│  └────────────────────────────────┘  │
│                                      │
│     [ Generate Pairing Code ]        │
│                                      │
│              OR                      │
│                                      │
│        [ Use QR Code ]               │
│                                      │
└──────────────────────────────────────┘

After generating:

┌──────────────────────────────────────┐
│          PAIRING CODE                │
│                                      │
│             8K4P-29MX                │
│                                      │
│ Open WhatsApp                        │
│ → Settings                           │
│ → Linked Devices                     │
│ → Link a Device                      │
│ → Link with phone number             │
│                                      │
│        🟡 Waiting...                 │
└──────────────────────────────────────┘

The actual pairing instructions must be updated if the current WhatsApp UI changes.

---

## 3.6 QR Fallback

If the selected WhatsApp library supports QR authentication reliably, provide QR as an alternative.

[ Pairing Code ]

      OR

[ QR Code ]

Do not make QR the only method.

The primary requested flow is phone number → pairing code → linked WhatsApp.

---

## 3.7 Session Persistence

Once paired, the account should remain connected after a normal server restart.

Do NOT require the administrator to pair the phone every time the application restarts.

The WhatsApp authentication state must be stored on persistent server-side storage using the selected library's supported authentication-state mechanism.

The browser must never receive raw authentication credentials.

Architecture:

WhatsApp
    ↓
WhatsApp Adapter
    ↓
Encrypted/Persistent Auth State
    ↓
Server storage

Not:

WhatsApp
 ↓
Browser
 ↓
localStorage

---

## 3.8 Reconnection

Temporary network failures must not immediately require re-pairing.

Example:

CONNECTED
   ↓
Internet interruption
   ↓
RECONNECTING
   ↓
Retry
   ↓
CONNECTED

Use exponential backoff with jitter.

Example conceptual delays:

2 sec
5 sec
10 sec
20 sec
40 sec

Do not reconnect infinitely without limits.

If the WhatsApp account has actually been logged out:

LOGGED_OUT
   ↓
Stop automatic reconnect
   ↓
Dashboard:
"WhatsApp needs to be paired again."

---

## 3.9 Connection Events

The WhatsApp adapter should emit events such as:

CONNECTION_STARTED
PAIRING_REQUIRED
PAIRING_CODE_GENERATED
CONNECTED
DISCONNECTED
RECONNECTING
LOGGED_OUT
CONNECTION_ERROR
MESSAGE_RECEIVED
GROUP_UPDATED

The backend converts these into internal application events.

The dashboard receives relevant events through WebSocket/SSE.

---

## 3.10 Dashboard Connection Status

The dashboard should never rely on the browser guessing whether WhatsApp is connected.

The server is authoritative.

Example:

Browser
   ↓
GET /api/whatsapp/status
   ↓
Backend
   ↓
WhatsApp Service

For real-time updates:

Backend
   ↓
WebSocket/SSE
   ↓
Dashboard

---

## 3.11 Disconnect Button

The dashboard must provide:

[ Disconnect WhatsApp ]

Before disconnecting, show confirmation.

After disconnect:

🔴 DISCONNECTED

The system should stop processing new WhatsApp events.

Existing queued outbound actions should be handled safely according to policy.

They should not suddenly be sent after an unexpected reconnection unless they are still valid.

---

## 3.12 Multiple WhatsApp Accounts

The initial implementation can support one WhatsApp account per installation.

However, design the database around:

whatsapp_accounts

rather than putting everything into a single global WhatsApp record.

This allows future expansion to multiple accounts without redesigning the entire database.

---

## 3.13 Important Security Rule

The WhatsApp session is extremely sensitive.

Never expose:

- Authentication state.
- Session files.
- Encryption keys.
- Internal WhatsApp credentials.
- Provider secrets.

through:

API responses
browser storage
frontend source code
logs
public files

---

