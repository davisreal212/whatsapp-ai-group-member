# Chapter 29 — DIRECT MESSAGE ALLOWLIST & PRIVATE CHAT CONTROL

## 29.1 Purpose

The AI is primarily designed for authorized WhatsApp groups, but the administrator may allow specific phone numbers to communicate with the AI through direct messages.

The system must use an explicit allowlist.

It must NOT automatically reply to every private message.

---

## 29.2 DM Policy

The dashboard should provide:

DIRECT MESSAGES

Mode:
[ Allowlisted Numbers Only ]

Allowed Numbers:
+2349067818955

[ + Add Number ]

The administrator can add or remove numbers at any time.

---

## 29.3 DM Processing Logic

Every incoming private message must pass through:

Incoming WhatsApp Message
          ↓
Is this a group?
     ┌────┴────┐
    YES        NO
     ↓          ↓
Group Rules   DM Allowlist
                ↓
        Number authorized?
           ┌────┴────┐
          YES        NO
           ↓          ↓
       Process      IGNORE

---

## 29.4 Example

Allowed:

+2349067818955

If that number sends:

"Hello"

the AI can reply.

If:

+2348011111111

sends:

"Hello"

the AI must ignore the message.

No AI response should be generated.

---

## 29.5 Important: Normalize Phone Numbers

The system must normalize numbers before comparison.

For example:

+2349067818955
2349067818955
09067818955

may represent the same Nigerian number.

The application should convert incoming numbers into a canonical format before checking the allowlist.

Recommended internal representation:

+2349067818955

Do not compare raw WhatsApp identifiers as plain strings without normalization.

---

## 29.6 Never Hard-Code the Number

Do NOT implement:

if (sender === "+2349067818955") {
   allow();
}

Instead use the database:

dm_allowlist

Example:

interface AllowedDMNumber {
  id: string;
  phoneNumber: string;
  enabled: boolean;
  nickname?: string;
  createdAt: Date;
  updatedAt: Date;
}

This allows the administrator to add:

+2349067818955
+2348012345678
+2348098765432

without changing application code.

---

## 29.7 Dashboard

Create a dedicated section:

┌─────────────────────────────────────────┐
│ DIRECT MESSAGE ACCESS                   │
├─────────────────────────────────────────┤
│                                         │
│ Mode                                    │
│ ● Allowlisted numbers only              │
│                                         │
│ Allowed Numbers                         │
│                                         │
│ +2349067818955       Enabled    [Delete]│
│                                         │
│ [+ Add Number]                          │
│                                         │
└─────────────────────────────────────────┘

---

## 29.8 Add Number

Click:

+ Add Number

Show:

Phone Number
[ +2349067818955 ]

Nickname (optional)
[ Brother ]

[ Add Number ]

The nickname is for the administrator/dashboard and does not need to be used by the AI.

---

## 29.9 Validation

Before saving:

✓ Valid phone number
✓ Correct country format
✓ Not already present
✓ Normalized

Invalid input:

+234abc123

must be rejected.

---

## 29.10 Enable/Disable

Do not require deleting a number just to temporarily block it.

Example:

+2349067818955
● Enabled

Administrator can switch:

○ Disabled

When disabled:

Incoming DM
      ↓
Number exists
      ↓
enabled = false
      ↓
IGNORE

---

## 29.11 Per-Number Personality

The system may optionally support:

Global Personality:
Female

DM-specific:
Default

or:

Global Personality:
Male

DM-specific:
Friendly

However, the global personality should remain the default unless specifically configured.

---

## 29.12 DM Memory Isolation

This is important.

Group conversations and private conversations should not automatically share unrestricted memory.

Example:

GROUP A
   ↓
Group A memory

GROUP B
   ↓
Group B memory

DM: +2349067818955
   ↓
Private conversation memory

A private conversation should not automatically expose information learned from another group.

Likewise, private information should not automatically enter a group context.

---

## 29.13 DM Conversation History

For an allowlisted number, maintain:

sender
message
timestamp
reply relationship
media
conversation summary
relevant memory

The AI can therefore continue a conversation naturally.

Example:

User:
Remember that BTC thing?

AI:
Yeah 😂 you were talking about the position earlier.

Only if that information actually exists in the permitted conversation context.

---

## 29.14 DM and Group Personality

The same AI identity can operate in both:

GROUP
↓
Group-aware personality

DM
↓
Private conversational personality

The dashboard can provide:

Group Personality
DM Personality

if desired.

---

## 29.15 DM Search

Allowlisted users can also trigger web research.

Example:

User:
What's BTC price now?

Pipeline:

DM
 ↓
Allowlist check
 ↓
Intent detection
 ↓
Search required
 ↓
Tavily
 ↓
Source verification
 ↓
AI response

The same truth/verification rules from Chapter 25 apply.

---

## 29.16 DM Media

Allowlisted users can use supported features such as:

Meme requests
Image understanding
Voice-note transcription
Audio responses
Web searches

subject to the same system limits.

---

## 29.17 DM Rate Limits

Private chats should have independent rate limits.

Example configuration:

Maximum messages/minute
Maximum AI responses/minute
Maximum searches/minute
Maximum media requests/hour

This prevents an allowlisted number from accidentally or intentionally consuming the entire AI quota.

---

## 29.18 Admin Emergency Control

Dashboard:

DIRECT MESSAGES
[ ENABLED ]

[ Disable All DMs ]

If disabled:

All private messages
→ IGNORE

Group functionality remains unaffected.

---

## 29.19 Audit Log

Record administrative changes:

DM number added
DM number removed
DM number disabled
DM number enabled
DM mode changed

Example:

2026-08-29 18:32
Admin
Added +2349067818955

Do not log message contents unnecessarily.

---

## 29.20 DM Decision Flow

Final logic:

MESSAGE RECEIVED
       │
       ▼
IDENTIFY CHAT TYPE
       │
   ┌───┴────┐
   │        │
 GROUP      DM
   │        │
   ▼        ▼
GROUP      NORMALIZE
AUTH       PHONE NUMBER
   │        │
   │        ▼
   │    ALLOWLIST CHECK
   │        │
   │    ┌───┴────┐
   │   YES       NO
   │    │         │
   │    ▼         ▼
   │ PROCESS     IGNORE
   │
   ▼
GROUP PROCESSING

---

## 29.21 Final Requirement

The coding agent must implement:

GROUPS:
Authorized groups only.

DIRECT MESSAGES:
Allowlisted numbers only.

EXAMPLE:
+2349067818955 → allowed

EVERY OTHER NUMBER:
ignored unless explicitly added by administrator.

The allowlist must be managed from the web dashboard and stored securely in the database.

No phone number should be hard-coded into the source code.