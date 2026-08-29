# Chapter 30 — WHATSAPP JID, IDENTITY RESOLUTION & CHAT AUTHORIZATION

## 30.1 Purpose

The WhatsApp integration must treat WhatsApp JIDs and message identifiers as first-class identities.

A phone number alone must NOT be used as the internal identity of a WhatsApp conversation.

The system should maintain a clear separation between:

Phone Number
WhatsApp JID
Chat JID
Sender JID
Message ID
Group ID

This prevents problems with replies, mentions, group identification, DM authorization, member profiles, and conversation memory.

---

## 30.2 What Is a JID?

A WhatsApp JID is an identifier used by the WhatsApp protocol/integration layer to identify an account or chat.

Examples may look like:

2349067818955@s.whatsapp.net

for an individual account, and:

1234567890-123456789@g.us

for a group.

The exact identifiers and formats depend on the WhatsApp integration/library being used.

Therefore:

«Never assume that a phone number string is always the complete WhatsApp identity.»

---

## 30.3 Phone Number vs JID

The dashboard may display:

+2349067818955

because this is easy for the administrator to understand.

Internally, the system should retain the WhatsApp identity supplied by the connection layer.

Example:

Display Phone:
+2349067818955

WhatsApp JID:
2349067818955@s.whatsapp.net

The phone number is the human-friendly identifier.

The JID is the WhatsApp-side identifier.

---

## 30.4 Never Hard-Code JID Formatting

Do NOT build the system around assumptions such as:

const jid = phone + "@s.whatsapp.net";

and assume that this will always correctly identify every account.

Instead:

Incoming WhatsApp Event
        ↓
Read identity supplied by WhatsApp library
        ↓
Identity Resolver
        ↓
Canonical internal identity

The integration adapter should be responsible for understanding the library's current JID format.

---

## 30.5 Identity Resolver

Create a dedicated component:

WhatsApp Identity Resolver

Architecture:

WhatsApp Event
      ↓
Identity Resolver
      ↓
┌──────────────────────────────┐
│ Chat JID                     │
│ Sender JID                   │
│ Message ID                   │
│ Phone/account information    │
│ Group information            │
└──────────────────────────────┘
      ↓
Canonical Identity

No other component should need to manually parse JIDs.

---

## 30.6 Canonical Identity

Create an internal representation:

interface WhatsAppIdentity {
  jid: string;

  normalizedPhone?: string;

  type: "user" | "group" | "broadcast" | "unknown";

  displayName?: string;

  pushName?: string;

  isGroup: boolean;

  rawJid?: string;
}

The exact fields can be extended depending on the WhatsApp library.

---

## 30.7 Chat Identity

Every incoming message must have a chat identity.

Example:

interface WhatsAppChat {
  jid: string;

  type: "group" | "dm" | "broadcast" | "unknown";

  name?: string;

  groupId?: string;
}

The "jid" should be treated as the primary internal chat identifier.

---

## 30.8 Message Identity

Every message must retain its original WhatsApp message identifier.

Example:

interface WhatsAppMessage {
  id: string;

  chatJid: string;

  senderJid: string;

  timestamp: number;

  text?: string;

  quotedMessageId?: string;

  messageType: string;
}

This is critical for replying to the correct message.

---

## 30.9 Group Identification

Groups should be authorized using the actual group JID.

Example:

Group JID:
1234567890-123456789@g.us

Database:

authorized_groups

group_jid
1234567890-123456789@g.us

enabled
true

Do NOT rely only on:

Group Name:
"Crypto Boys"

because group names can change and multiple groups may have the same name.

---

## 30.10 Group Authorization

Incoming message:

chatJid:
1234567890-123456789@g.us

System:

Search authorized_groups
        ↓
JID exists?
     ┌──┴──┐
    YES    NO
     ↓      ↓
 Process   Ignore

---

## 30.11 Unknown Groups

If the WhatsApp account receives a message from a group that has not been authorized:

UNKNOWN GROUP
      ↓
NO AI PROCESSING
      ↓
NO RESPONSE

The system must not accidentally reply in unknown groups.

---

## 30.12 DM Identification

For a direct message:

chatJid
     ↓
Identity Resolver
     ↓
Resolve account/phone identity
     ↓
DM Allowlist

Example:

Allowed:
+2349067818955

Incoming identity:
2349067818955@s.whatsapp.net

       ↓

Resolved phone:
+2349067818955

       ↓

ALLOW

---

## 30.13 DM Allowlist Must Not Depend on Raw String Matching

Do NOT simply do:

allowedNumbers.includes(senderJid)

because:

+2349067818955

and:

2349067818955@s.whatsapp.net

are different strings.

Instead:

Incoming JID
      ↓
Identity Resolver
      ↓
Canonical phone/account identity
      ↓
Allowlist comparison

---

## 30.14 Store Both Phone and JID

Where available, the database should store both.

Example:

interface DMAllowlistEntry {
  id: string;

  normalizedPhone: string;

  whatsappJid?: string;

  displayName?: string;

  enabled: boolean;

  createdAt: Date;

  updatedAt: Date;
}

This provides a reliable mapping while still allowing the system to handle changes in the underlying WhatsApp identity.

---

## 30.15 Identity Mapping Table

Recommended table:

whatsapp_identities

id
internal UUID

jid
WhatsApp JID

normalized_phone
+2349067818955

type
user/group

display_name
optional

last_seen_at
timestamp

created_at
timestamp

updated_at
timestamp

This becomes the central identity mapping layer.

---

## 30.16 Message Storage

Every message should store:

message_id
chat_jid
sender_jid
sender_identity_id
message_type
text
timestamp
quoted_message_id

Example:

message_id:
ABC123

chat_jid:
1234567890-123456789@g.us

sender_jid:
2349067818955@s.whatsapp.net

quoted_message_id:
XYZ789

This allows the AI to reconstruct conversations correctly.

---

## 30.17 Reply Handling

If the AI wants to reply to a message:

AI
 ↓
targetMessageId
 ↓
Message Store
 ↓
Retrieve original WhatsApp message
 ↓
WhatsApp Adapter
 ↓
Native reply

Do not attempt to reconstruct a reply using only:

sender phone number

The original message ID should be used.

---

## 30.18 Reply to Reply

If someone replies to a previous message:

John:
BTC is moving.

David:
[Reply to John]
"Up or down?"

AI:
[Reply to David]
"Looks bullish right now."

The incoming message must retain:

messageId
quotedMessageId
chatJid
senderJid

This allows the Context Engine to understand the conversation chain.

---

## 30.19 Mentions

Mentions should use the identifiers provided by the WhatsApp integration.

Do not create mentions by simply inserting:

@2349067818955

into text.

The WhatsApp adapter should construct the appropriate mention metadata using the actual participant identity.

---

## 30.20 Mention-All

If mention-all is supported by the integration, the application should obtain the actual participant list from the group metadata.

Do not assume:

@all

is universally supported.

Implementation must depend on what the selected WhatsApp integration actually supports.

---

## 30.21 Member Identity

Each group member should have a group-specific relationship with the WhatsApp identity.

Example:

whatsapp_identity
       ↓
group_membership
       ↓
member_profile

This allows the same account to appear in multiple groups while maintaining separate group-specific behavioral context.

---

## 30.22 Member Profile Architecture

Example:

interface GroupMember {
  id: string;

  groupJid: string;

  identityId: string;

  displayName?: string;

  firstSeenAt: Date;

  lastSeenAt: Date;

  profileEnabled: boolean;
}

The behavioral profile should reference this membership instead of relying only on the phone number.

---

## 30.23 Group-Specific Personality Learning

Example:

John
    │
    ├── Group A profile
    │      casual
    │      humorous
    │
    └── Group B profile
           technical
           formal

The AI must not assume that behavior observed in one group automatically represents behavior in another group.

---

## 30.24 Identity Changes

If the WhatsApp integration reports a changed identifier or updated account information:

New identity information
        ↓
Identity Resolver
        ↓
Match existing identity if possible
        ↓
Update mapping
        ↓
Preserve conversation history

Do not automatically create duplicate users every time WhatsApp returns a different representation of the same identity.

---

## 30.25 Unknown Identity

If the system cannot confidently resolve an incoming identity:

identity confidence = low

The AI should not make assumptions.

For authorization:

Unknown DM
→ IGNORE

For an authorized group:

Unknown sender inside authorized group
→ Message can be processed
→ Do not invent a member profile

A temporary identity can be created and resolved later.

---

## 30.26 Group Metadata Refresh

The system should periodically refresh group metadata.

Useful information:

Group JID
Group name
Participants
Participant JIDs
Admin status
Group settings

Do not continuously request metadata for every message if the integration provides caching.

Use:

cache
+
event updates
+
periodic refresh

---

## 30.27 Identity Cache

Create an identity cache:

JID
 ↓
Resolved identity

This reduces repeated processing.

Example:

2349067818955@s.whatsapp.net
        ↓
identityId = UUID-123
phone = +2349067818955

Cache entries should have an appropriate expiration/update policy.

---

## 30.28 JID Parsing Must Be Isolated

Do not scatter code such as:

split("@")
replace("@s.whatsapp.net", "")
endsWith("@g.us")

throughout the project.

Create one adapter:

WhatsAppIdentityResolver

All application components use its output.

This makes the system easier to update if the WhatsApp library changes its identity representation.

---

## 30.29 WhatsApp Adapter Layer

The application should not directly depend on the unofficial WhatsApp library everywhere.

Use:

AI Application
       ↓
WhatsApp Adapter Interface
       ↓
Unofficial WhatsApp Implementation

Example:

interface WhatsAppAdapter {
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  getChats(): Promise<WhatsAppChat[]>;

  getGroupMetadata(jid: string): Promise<any>;

  sendText(chatJid: string, text: string): Promise<void>;

  reply(
    chatJid: string,
    messageId: string,
    text: string
  ): Promise<void>;

  react(
    chatJid: string,
    messageId: string,
    emoji: string
  ): Promise<void>;

  sendMedia(
    chatJid: string,
    media: Buffer,
    options?: any
  ): Promise<void>;
}

The actual methods must be adapted to the chosen WhatsApp library.

---

## 30.30 Why the Adapter Is Important

Without an adapter:

AI
 ↓
WhatsApp library
 ↓
Every component knows WhatsApp internals

This creates a fragile application.

With an adapter:

AI
 ↓
WhatsApp Adapter
 ↓
WhatsApp library

Only one layer understands the specific JID/message APIs.

---

## 30.31 Connection Reconnection

The WhatsApp connection may disconnect.

The system should support:

Connected
   ↓
Disconnected
   ↓
Reconnect
   ↓
Identity synchronization
   ↓
Resume processing

Avoid creating duplicate sessions.

---

## 30.32 Duplicate Message Protection

Unofficial integrations may reconnect or emit events more than once.

Every message should have an idempotency check.

Example:

Incoming message ID:
ABC123

Already processed?
YES → ignore duplicate

NO → process

Database constraint:

UNIQUE(chat_jid, message_id)

or the equivalent supported by the chosen integration.

---

## 30.33 Outbound Message Protection

The AI must also avoid sending duplicate responses.

Before sending:

Generate action ID
        ↓
Check outbound queue
        ↓
Already sent?
YES → stop
NO → send

This is especially important after worker restarts.

---

## 30.34 Final Identity Architecture

                         WHATSAPP
                             │
                             ▼
                     RAW EVENT RECEIVER
                             │
                             ▼
                    IDENTITY RESOLVER
                             │
             ┌───────────────┼────────────────┐
             ▼               ▼                ▼
          Chat JID        Sender JID       Message ID
             │               │                │
             ▼               ▼                ▼
        Chat Identity    User Identity    Message Store
             │               │
        ┌────┴────┐          │
        ▼         ▼          ▼
      GROUP       DM     Member Profile
        │         │
        ▼         ▼
 Group Allowlist DM Allowlist
        │         │
        └────┬────┘
             ▼
        AI PROCESSING
             │
             ▼
       CONTEXT ENGINE
             │
             ▼
       DECISION ENGINE
             │
             ▼
       WHATSAPP ADAPTER
             │
             ▼
          WHATSAPP

---

## 30.35 Final Security Rules

The implementation must follow these rules:

1. Never trust a display name as an identity.

2. Never use group names as authorization keys.

3. Never compare raw JIDs directly with phone numbers.

4. Never hard-code a specific JID.

5. Never assume every JID follows one permanent format.

6. Always use the actual message ID for replies.

7. Always use the actual participant identity for mentions.

8. Unknown DMs must not automatically receive responses.

9. Unknown groups must not automatically receive responses.

10. Group authorization must be based on stable WhatsApp chat identity.

11. DM authorization must be based on the resolved account identity.

12. JID parsing must exist in one dedicated adapter/resolver.

13. Conversation history must be associated with the correct chat.

14. Group member profiles must be scoped to the correct group.

15. Duplicate messages must be detected and ignored.

16. Provider/API credentials must never be exposed to WhatsApp users.

---

## 30.36 Final DM Example

Administrator adds:

+2349067818955

The system stores:

normalizedPhone:
+2349067818955

whatsappJid:
2349067818955@s.whatsapp.net

enabled:
true

Incoming message:

senderJid:
2349067818955@s.whatsapp.net

Processing:

Incoming message
      ↓
Identity Resolver
      ↓
Resolved identity
      ↓
+2349067818955
      ↓
DM allowlist
      ↓
enabled = true
      ↓
AI processing
      ↓
Response

Another person:

senderJid:
2348011111111@s.whatsapp.net

Processing:

Incoming message
      ↓
Identity Resolver
      ↓
+2348011111111
      ↓
Not in allowlist
      ↓
IGNORE

No AI generation should be performed for the unauthorized DM.

---

## 30.37 Final Group Example

Authorized group:

1234567890-123456789@g.us

Incoming:

chatJid:
1234567890-123456789@g.us

Processing:

Group JID
    ↓
Authorized Groups
    ↓
Enabled
    ↓
Process message

Unknown group:

9876543210-987654321@g.us

Processing:

Group JID
    ↓
Authorized Groups
    ↓
Not found
    ↓
IGNORE

---

## 30.38 Chapter 30 Acceptance Criteria

☐ Dedicated WhatsApp Identity Resolver
☐ JID-aware architecture
☐ Phone normalization
☐ Group JID authorization
☐ DM identity resolution
☐ DM allowlist
☐ Message ID storage
☐ Reply-chain support
☐ Mention identity support
☐ Group member identity mapping
☐ Group-specific member profiles
☐ Identity cache
☐ Metadata cache
☐ Duplicate message protection
☐ Duplicate outbound protection
☐ Reconnection handling
☐ WhatsApp adapter layer
☐ No hard-coded JIDs
☐ No raw JID/phone comparison
☐ Unknown DM protection
☐ Unknown group protection

END OF CHAPTER 30