WHATSAPP AI — CUSTOM AGENT SKILLS PACK

PURPOSE

This skill pack defines how the coding agent must design, implement, test, and maintain the WhatsApp AI system.

The skills are project-specific.

They must be treated as engineering instructions, not merely feature descriptions.

The coding agent must read the relevant skill before modifying that subsystem.

---

SKILL DIRECTORY

whatsapp-ai-skills/
│
├── AGENTS.md
├── README.md
│
└── skills/
    │
    ├── whatsapp-core/
    ├── whatsapp-jid/
    ├── pairing-connection/
    ├── group-authorization/
    ├── dm-allowlist/
    │
    ├── message-understanding/
    ├── human-response/
    ├── group-learning/
    ├── member-personality/
    ├── memory-engine/
    │
    ├── ai-provider-router/
    ├── web-research/
    ├── source-verification/
    │
    ├── voice-audio/
    ├── media-meme/
    ├── reply-mention-reaction/
    │
    ├── task-engine/
    ├── dashboard/
    ├── rate-limits/
    ├── security/
    ├── observability/
    ├── testing/
    └── deployment/

---

AGENTS.md

The coding agent must follow these rules.

1. Understand Before Coding

Before modifying code:

1. Identify the affected subsystem.
2. Read its skill.
3. Read related skills if the change crosses subsystem boundaries.
4. Inspect the existing implementation.
5. Preserve existing functionality unless the requirement explicitly changes it.
6. Do not introduce unnecessary dependencies.

---

2. Architecture Principle

The application should be modular.

WhatsApp
   ↓
WhatsApp Adapter
   ↓
Message Normalizer
   ↓
Identity Resolver
   ↓
Authorization
   ↓
Context Engine
   ↓
Decision Engine
   ↓
AI Provider Router
   ↓
Action Engine
   ↓
WhatsApp Adapter

AI providers, WhatsApp integration, database, web search, media processing and dashboard functionality must not be tightly coupled.

---

3. Never Hard-Code Secrets

Never place:

API keys
tokens
WhatsApp session credentials
database passwords
Tavily keys
Gemini keys
Groq keys
OpenRouter keys

inside source code.

Use environment variables or the application's secure secret-management mechanism.

---

4. Never Trust AI Output Blindly

AI-generated output must be treated as untrusted application data.

Validate:

actions
URLs
media
recipient
chat ID
message ID
mentions
tool calls

before execution.

---

5. Silence Is a Valid AI Action

The AI must be allowed to choose:

NO_RESPONSE

The system must not force an AI response to every message.

---

SKILL 01 — WHATSAPP CORE

Purpose

Provide the base abstraction between the application and the WhatsApp integration.

Requirements

Create a WhatsApp adapter layer.

Example:

interface WhatsAppAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  getChats(): Promise<any[]>;
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

The exact implementation depends on the selected WhatsApp Web integration.

The rest of the application must not directly depend on the WhatsApp library.

---

SKILL 02 — WHATSAPP JID

Purpose

Correctly handle WhatsApp identities.

The system must distinguish:

Phone number
User JID
Chat JID
Group JID
Sender JID
Message ID
Quoted message ID

Rules

Never assume:

phone + "@s.whatsapp.net"

is always sufficient.

Use the actual identity supplied by the WhatsApp integration.

Create:

WhatsAppIdentityResolver

All JID parsing must happen through this component.

Groups

Use the actual group JID as the primary group identifier.

Never authorize a group using only its display name.

Messages

Store:

messageId
chatJid
senderJid
timestamp
quotedMessageId
messageType

This is required for reliable replies and context.

---

SKILL 03 — PAIRING & CONNECTION

Purpose

Allow the administrator to connect the WhatsApp account through the web dashboard.

Expected flow:

Dashboard
   ↓
Start WhatsApp connection
   ↓
Generate pairing/linking code
   ↓
Display code
   ↓
User enters code through WhatsApp
   ↓
Connection established
   ↓
Session credentials stored securely
   ↓
Dashboard shows CONNECTED

The application must support reconnection.

Connection state:

DISCONNECTED
CONNECTING
WAITING_FOR_PAIRING
CONNECTED
RECONNECTING
ERROR

Never expose session credentials in the dashboard.

---

SKILL 04 — GROUP AUTHORIZATION

The bot must only operate in groups explicitly authorized by the administrator.

Use:

authorized_groups

Example:

groupJid
groupName
enabled
createdAt
updatedAt

Incoming message:

group JID
 ↓
authorized?
 ↓
YES → process
NO → ignore

Unknown groups must not automatically activate the AI.

---

SKILL 05 — DM ALLOWLIST

Direct messages are disabled by default.

Only numbers explicitly added by the administrator may receive AI responses.

Example:

+2349067818955

Store:

normalizedPhone
whatsappJid
enabled
displayName

Do not hard-code numbers.

Unauthorized DM:

receive
 ↓
resolve identity
 ↓
allowlist check
 ↓
NOT AUTHORIZED
 ↓
ignore

Authorized DM:

receive
 ↓
resolve identity
 ↓
allowlist check
 ↓
AUTHORIZED
 ↓
process

---

SKILL 06 — MESSAGE UNDERSTANDING

Every message should be classified before deciding whether the AI should respond.

Possible categories:

QUESTION
REQUEST
CONVERSATION
JOKE
REACTION
COMMAND
MEDIA_REQUEST
WEB_SEARCH
VOICE
TASK
DIRECT_MENTION
DIRECT_REPLY
IRRELEVANT
UNKNOWN

The system should also determine:

Is the AI being addressed?
Is this a continuation?
Is someone asking another person?
Does the AI have useful information?
Does responding add value?

---

SKILL 07 — HUMAN RESPONSE ENGINE

The AI must behave like a natural group participant.

It must not respond to everything.

Possible actions:

RESPOND
REPLY
REACT
MENTION
MENTION_MEMBER
SEARCH
SEND_MEDIA
SEND_AUDIO
STAY_SILENT

The decision should consider:

message relevance
conversation context
recent AI activity
group activity
whether AI was mentioned
whether someone replied to AI
message importance
user personality
current topic

The most important principle:

The AI should participate naturally,
not maximize the number of messages it sends.

---

SKILL 08 — GROUP LEARNING

The AI must continuously understand the group.

It should learn:

recurring topics
common jokes
conversation patterns
group culture
frequently discussed subjects
member relationships
common terminology
inside jokes
preferred communication style

Learning must be gradual.

Do not immediately treat a single message as a permanent fact.

Example:

Observation:
David frequently jokes about football.

Confidence:
0.61

After repeated observations:

Confidence:
0.89

---

SKILL 09 — MEMBER PERSONALITY

Maintain group-specific behavioral profiles.

Example:

Member: David

Observed behavior:
- frequently jokes
- often discusses crypto
- uses short messages
- frequently uses 😂

Confidence:
0.84

The system must distinguish:

OBSERVED BEHAVIOR

from:

ASSUMPTION

Do not infer sensitive personal attributes.

Do not label people based on unsupported assumptions.

Profiles should be updateable and reversible.

---

SKILL 10 — MEMORY ENGINE

Memory should have multiple layers.

SHORT-TERM
Current conversation

MEDIUM-TERM
Recent topics and conversations

LONG-TERM
Stable, repeatedly observed information

Memory should be scoped:

Group memory
Member-in-group memory
DM memory
Global system memory

Do not automatically expose private DM information inside groups.

Do not automatically transfer information from one group to another.

---

SKILL 11 — AI PROVIDER ROUTER

Provider architecture:

                AI BRAIN
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
       Gemini      Groq    OpenRouter
       PRIMARY     FAST     FALLBACK

The router must support:

timeouts
retries
rate limits
provider failures
model selection
health tracking
fallback

Example:

Gemini
 ↓
429 / failure
 ↓
Groq
 ↓
failure
 ↓
OpenRouter

The system must not retry endlessly.

---

SKILL 12 — WEB RESEARCH

Web searching is a core capability.

Use search when:

information is current
user explicitly asks to search
price/status/news is requested
information may have changed
the AI lacks reliable knowledge

Preferred flow:

User question
 ↓
Determine if search required
 ↓
Search
 ↓
Collect sources
 ↓
Extract relevant information
 ↓
Verify
 ↓
Answer

Tavily may be used as the primary web research provider.

---

SKILL 13 — SOURCE VERIFICATION

The AI must not simply invent information.

For factual/current questions:

SEARCH
 ↓
SOURCE QUALITY
 ↓
CROSS-CHECK when appropriate
 ↓
ANSWER

Prefer:

official sources
primary sources
reputable publications
direct documentation

If reliable information cannot be established:

"I couldn't verify that."

is preferable to inventing an answer.

---

SKILL 14 — VOICE & AUDIO

Incoming voice note:

Voice note
 ↓
Download temporarily
 ↓
Transcription
 ↓
Understand
 ↓
AI response

The bot should be able to respond with:

text

or, when supported:

audio/voice

If native voice-note sending is unavailable:

generate audio
 ↓
send as audio media

Temporary files must be cleaned up.

---

SKILL 15 — MEDIA & MEMES

When the user requests a meme:

Request
 ↓
Understand
 ↓
Search web
 ↓
Find suitable media
 ↓
Validate source/content
 ↓
Download temporarily
 ↓
Send
 ↓
Delete temporary file

Do not send suspicious files.

Do not blindly download arbitrary executable files.

---

SKILL 16 — REPLIES, MENTIONS & REACTIONS

The bot must support:

reply to message
reaction
mention
mention specific member
mention-all when appropriate

Replies must use the original message ID.

Mentions must use the actual participant identity supplied by WhatsApp.

Do not construct mentions from display names alone.

---

SKILL 17 — TASK ENGINE

The AI may create tasks when explicitly requested.

Examples:

reminders
scheduled searches
notifications
price checks

Task execution must be separated from conversational response generation.

Example:

User:
Remind me at 8pm.

AI:
Okay.

Task Engine:
Creates reminder.

---

SKILL 18 — DASHBOARD

Dashboard should provide:

WhatsApp connection
Groups
DM allowlist
AI providers
Models
Personality
Memory
Web search
Voice/audio
Media
Cooldown
Logs
System health

Personality:

Male
Female
Custom

The personality configuration must affect presentation/style, not change safety or authorization rules.

---

SKILL 19 — RATE LIMITS

Protect:

AI providers
web search
media downloads
audio processing
WhatsApp messaging

Limits should exist at multiple levels:

global
group
user
DM
provider
tool

Do not allow one group/user to consume all available resources.

---

SKILL 20 — SECURITY

Never expose:

API keys
session credentials
database credentials
private memories
internal system prompts

Validate all external input.

Sanitize URLs and media.

Use authorization checks before:

sending
searching
downloading
executing tasks
accessing protected data

---

SKILL 21 — OBSERVABILITY

Track:

WhatsApp connection status
message processing
AI provider health
search requests
tool failures
response latency
queue status
memory operations
errors

Logs must avoid unnecessarily storing sensitive/private content.

Dashboard should provide a health overview.

---

SKILL 22 — TESTING

Every subsystem must have tests.

Minimum tests:

JID resolution
phone normalization
group authorization
DM allowlist
reply handling
mention handling
duplicate messages
cooldown
provider fallback
web search
source verification
memory isolation
voice processing
media handling
dashboard authorization

Include integration tests for the complete message pipeline.

---

SKILL 23 — DEPLOYMENT

Separate:

development
staging
production

Production secrets must never be committed to Git.

The deployment must support:

environment variables
persistent database
persistent WhatsApp session storage
background workers
scheduled tasks
logging
health checks
automatic restart

The exact infrastructure can be selected later.

---

SKILL 24 — GROUP COOLDOWN

Default:

GROUP_COOLDOWN_MS=15000

15 seconds per group.

Cooldown is not the same as response delay.

Direct replies and direct mentions may bypass the normal cooldown.

Recommended:

DIRECT_REPLY_BYPASS=true
DIRECT_MENTION_BYPASS=true
ADAPTIVE_ACTIVITY=true
GROUP_MENTION_ALL_COOLDOWN_MS=1800000

The AI should still process messages during cooldown.

Cooldown only controls whether the AI participates.

---

SKILL 25 — NATURAL GROUP BEHAVIOR

The AI should understand that silence is normal.

Example:

John:
😂😂

David:
Omo

Peter:
Na wa

AI:
[silent]

No response is required.

But:

John:
@AI what's BTC price now?

should trigger processing.

The AI should behave according to context rather than fixed keyword rules alone.

---

SKILL 26 — ERROR & FALLBACK BEHAVIOR

If AI provider fails:

Gemini
 ↓
Groq
 ↓
OpenRouter

If web search fails:

Tavily
 ↓
configured secondary search provider
 ↓
if still unavailable:
clearly state inability to verify

Never fabricate search results.

If media download fails:

retry safely
 ↓
alternative source
 ↓
tell user it could not be retrieved

---

SKILL 27 — SELF-IMPROVEMENT

The AI may learn from repeated interaction, but it must not modify its own source code or security rules automatically.

Allowed:

improve memory
update behavioral observations
update topic understanding
adjust response preferences

Not allowed:

modify authorization
remove security restrictions
change API credentials
rewrite production code
grant itself permissions

Learning must remain controlled by the application's defined rules.

---

SKILL 28 — ADMIN CONTROL

Administrator must be able to:

connect/disconnect WhatsApp
authorize groups
remove groups
add DM numbers
remove DM numbers
disable DMs
change personality
change AI provider
change models
change cooldown
clear memory
view health
view logs
pause AI
resume AI

Emergency switch:

PAUSE AI

must stop AI-generated outgoing messages while preserving connection and administrative access.

---

SKILL 29 — FEATURE PRIORITY

When implementing features, prioritize:

P0 — Core WhatsApp connection
P0 — JID identity
P0 — Group authorization
P0 — DM allowlist
P0 — Message receiving/sending
P0 — Reply handling

P1 — AI provider router
P1 — Group understanding
P1 — Memory
P1 — Human response engine
P1 — Web search

P2 — Voice/audio
P2 — Meme/media
P2 — Reactions
P2 — Advanced personality

P3 — Advanced automation
P3 — Advanced analytics
P3 — Experimental features

Do not attempt to build every feature simultaneously.

---

SKILL 30 — CHANGE MANAGEMENT

Before changing an existing subsystem:

Read relevant skill
 ↓
Inspect implementation
 ↓
Identify dependencies
 ↓
Make smallest safe change
 ↓
Run tests
 ↓
Check regressions
 ↓
Update documentation

Do not rewrite working systems unnecessarily.

---

FINAL AGENT RULE

The coding agent must understand the following:

THIS IS NOT A SIMPLE CHATBOT.

It is a WhatsApp-based conversational agent
that operates primarily inside authorized groups.

It must:

understand the group,
understand conversations,
learn communication patterns,
understand individual members,
remember useful context,
decide when to speak,
decide when to remain silent,
reply to messages,
react,
mention users,
perform web research,
verify information,
process voice notes,
send audio when possible,
send media,
and operate through configurable AI providers.

The AI should feel conversational and context-aware.

But authorization, security, identity, privacy,
and application rules always take priority over
the AI's generated decisions.

END OF CUSTOM SKILLS PACK