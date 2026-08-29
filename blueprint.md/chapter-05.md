# Chapter 5 — MESSAGE INGESTION, NORMALIZATION & CONVERSATION EVENTS

## 5.1 Purpose

This chapter creates the pipeline that converts raw WhatsApp events into clean internal events that the AI can understand.

The AI should never directly consume raw WhatsApp library objects.

---

## 5.2 Raw Event

The WhatsApp library may produce a complicated event.

The system must immediately convert it:

Raw WhatsApp Event
        ↓
Event Parser
        ↓
Message Normalizer
        ↓
Canonical MessageEvent

---

## 5.3 Canonical MessageEvent

Use a structure similar to:

interface MessageEvent {
  id: string;

  whatsappMessageId: string;

  groupId: string;

  senderId: string;

  senderName?: string;

  timestamp: number;

  type:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "reaction";

  text?: string;

  quotedMessageId?: string;

  quotedSenderId?: string;

  mentionedMemberIds: string[];

  isReplyToBot: boolean;

  isMentioningBot: boolean;

  isFromBot: boolean;

  media?: MediaMetadata;
}

---

## 5.4 Message Processing Pipeline

Every incoming event should follow:

WhatsApp Event
      ↓
Parse
      ↓
Normalize
      ↓
Duplicate check
      ↓
Is group?
      ↓
Is group enabled?
      ↓
Is AI paused?
      ↓
Identify sender
      ↓
Detect reply
      ↓
Detect mentions
      ↓
Detect message type
      ↓
Store required metadata
      ↓
Conversation context
      ↓
Decision Engine

---

## 5.5 Duplicate Detection

Before processing:

message ID
    ↓
processed_events
    ↓
Already exists?

If yes:

IGNORE

If no:

Mark received
↓
Continue

This prevents duplicate responses.

---

## 5.6 Bot's Own Messages

The system must identify messages sent by the AI itself.

Example:

AI:
"BTC looking wild 😂"

WhatsApp event
      ↓
senderId == botId
      ↓
isFromBot = true

Normally, the AI should not respond to its own message.

However, its own messages must still be stored as conversation context so it can understand future replies.

---

## 5.7 Detecting Replies

This is extremely important.

Example:

AI:
"BTC is moving hard today."

John:
"Why do you think so?"

The system should detect:

isReplyToBot = true

and:

quotedMessageId = AI message ID

This becomes a strong signal for the decision engine.

---

## 5.8 Detecting Mentions

If the message contains the AI's WhatsApp identifier:

@AI

the system should mark:

isMentioningBot = true

Do not rely only on text matching.

Use actual WhatsApp mention metadata where available.

---

## 5.9 Mentioning Other Members

Example:

John:
@David check this 😂

The system should record:

mentionedMemberIds:
[
  "David WhatsApp ID"
]

This helps understand who the message is directed toward.

---

## 5.10 Message Types

The normalizer should support:

TEXT
IMAGE
VIDEO
AUDIO
DOCUMENT
STICKER
REACTION

The AI does not necessarily need to analyze every type immediately.

For unsupported media:

Store metadata
↓
Do not crash
↓
Continue safely

---

## 5.11 Text Extraction

For text messages:

message.text

should be normalized.

Remove unnecessary transport artifacts while preserving meaningful content.

For example:

"@AI 😂 what do you think?"

should remain semantically equivalent.

Do not aggressively clean emojis, slang or Nigerian Pidgin.

Those are valuable social signals.

---

## 5.12 Language Detection

The system should eventually identify:

English
Nigerian Pidgin
mixed English/Pidgin
other supported languages

Do not automatically translate everything into standard English.

The original language/style is important for human-like responses.

Example:

"Abeg wetin happen?"

should remain recognizable as Pidgin.

---

## 5.13 Voice Note Event

When an audio/voice message arrives:

WhatsApp
 ↓
Audio event
 ↓
Temporary download
 ↓
Speech-to-text
 ↓
Transcript
 ↓
MessageEvent.text

The MessageEvent should also retain:

type = "audio"

so the AI knows the original input was voice.

---

## 5.14 Media Metadata

For media messages store only useful metadata initially.

Example:

interface MediaMetadata {
  mimeType?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  temporaryPath?: string;
}

Do not permanently store every image/video unless configured.

---

## 5.15 Message Retention

The system should have configurable retention.

Possible modes:

Short
Medium
Long
Custom

Older raw message content can be deleted while keeping useful summarized memory.

Example:

Raw messages:
Deleted after retention period

Group summary:
Retained

Behavioral observations:
Retained with confidence

This reduces storage and unnecessary exposure of private conversation data.

---

## 5.16 Conversation Context

The AI should receive recent relevant messages.

Example:

CURRENT CONTEXT

John:
BTC looking crazy today

David:
It might hit 80k soon

John:
@AI what you think?

CURRENT MESSAGE:
@AI what you think?

The AI can now understand the conversation.

---

## 5.17 Context Window Rules

Do not send the entire group history to the model.

Use:

Recent messages
+
Relevant older summary
+
Relevant member memory
+
Relevant group memory
+
Current message

This keeps prompts efficient and protects free-tier quotas.

---

## 5.18 Conversation Summarization

When the recent context becomes too large:

Recent messages
      ↓
Summarizer
      ↓
Conversation summary

Example:

The group has been discussing whether BTC can reach
$80,000. David believes it may happen soon. John asked
the AI for an opinion.

Keep summaries factual.

Do not invent motivations.

---

## 5.19 Topic Context

The system should attach relevant topic information.

Example:

Current topic:
BTC price

Related recent topic:
BTC reaching 80k

Relevant member:
John frequently discusses crypto

This gives the response model useful context without dumping everything.

---

## 5.20 Social Priority Signals

The normalized event should eventually generate signals such as:

DIRECT_MENTION
REPLY_TO_BOT
DIRECT_QUESTION
BOT_REFERENCED
RELEVANT_TOPIC
MEMBER_REQUEST
TASK_REQUEST
NORMAL_CHAT
LOW_RELEVANCE

These signals are used by the decision engine in the next chapter.

---

## 5.21 Example: Normal Chat

John:
Guy this weather 😂

David:
Omo don't remind me

Mary:
I'm literally melting 😂

System:

Group:
Enabled

AI mentioned:
NO

Reply to AI:
NO

Question:
NO

Useful intervention:
LOW

Decision:
Do not involve AI yet.

---

## 5.22 Example: Direct Mention

John:
@AI abeg what's BTC price now?

System:

Group:
Enabled

AI mentioned:
YES

Question:
YES

Current information required:
YES

Web research:
YES

Decision:
Respond after verification.

---

## 5.23 Example: Reply to AI

AI:
BTC is moving hard today.

John:
Why?

System:

Reply to AI:
YES

Conversation continuity:
HIGH

Decision:
Respond.

---

## 5.24 Example: Future Task

John:
@AI once BTC hit 80k abeg let me know.

System:

Mention:
YES

Intent:
CONDITIONAL_NOTIFICATION

Asset:
BTC

Condition:
>= 80000 USD

Owner:
John

Group:
Current group

Action:
CREATE_TASK

This should create a task rather than simply answering.

---

## 5.25 Example: Member-to-Member Conversation

John:
@David you still owe me 😂

David:
I know bro 😭

AI:

No mention
No direct question
No useful intervention

→ IGNORE

The AI should not insert itself into every conversation.

---

## 5.26 Message Ingestion Performance

The ingestion pipeline must be fast.

Do not block event processing while doing expensive operations unnecessarily.

Use asynchronous jobs for:

- Speech-to-text.
- Image analysis.
- Long summarization.
- Memory extraction.
- Web research.
- Media processing.

The immediate ingestion path should remain lightweight.

---

## 5.27 Event Queue

Recommended architecture:

WhatsApp
    ↓
Event Listener
    ↓
Fast Validation
    ↓
Message Queue
    ↓
Message Processor

This prevents a slow AI request from blocking WhatsApp event handling.

---

## 5.28 Event Processing States

Track states such as:

RECEIVED
NORMALIZED
FILTERED
PROCESSING
DECIDING
ACTION_QUEUED
COMPLETED
IGNORED
FAILED

This makes debugging much easier.

---

## 5.29 Chapter 5 Acceptance Criteria

The chapter is complete when:

☐ Raw WhatsApp events are normalized
☐ Group filtering occurs early
☐ DMs are rejected
☐ Duplicate messages are detected
☐ Bot's own messages are identified
☐ Replies are detected
☐ Mentions are detected
☐ Member IDs are normalized
☐ Text is preserved correctly
☐ Pidgin/emoji/slang are preserved
☐ Media types are recognized
☐ Voice events can enter STT pipeline
☐ Conversation context is generated
☐ Context is size-limited
☐ Older context can be summarized
☐ Topic context exists
☐ Processing is asynchronous where appropriate
☐ Event states are logged
☐ No AI action can bypass group authorization

---

FINAL ARCHITECTURE AFTER CHAPTERS 3–5

At this point the system should look like:

                    WEB DASHBOARD
                          │
                          │
                    AUTHENTICATED
                          │
                          ▼
                 WHATSAPP SERVICE
                          │
                          ▼
                  WHATSAPP ADAPTER
                          │
                          ▼
                     WHATSAPP
                          │
                          ▼
                  RAW MESSAGE EVENT
                          │
                          ▼
                ┌──────────────────┐
                │ POLICY FILTER    │
                └────────┬─────────┘
                         │
             ┌───────────┴───────────┐
             │                       │
            DM                  ENABLED GROUP
             │                       │
           DROP                      ▼
                              NORMALIZATION
                                    │
                                    ▼
                              MESSAGE EVENT
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
                 CONTEXT         MEMORY          MEMBER
                    │               │           INTELLIGENCE
                    └───────────────┼───────────────┘
                                    │
                                    ▼
                             DECISION ENGINE

The next major layer is where the bot starts becoming genuinely intelligent:

