# Chapter 31 — GROUP COOLDOWN, RESPONSE FREQUENCY & NATURAL TIMING

## 31.1 Purpose

The AI must not reply to every message in a group.

Even when the AI decides that a message is potentially relevant, it should consider whether it has recently responded in that group.

This prevents:

AI:
😂

AI:
Exactly.

AI:
That's crazy.

AI:
Wait...

AI:
Actually...

from happening continuously.

The goal is to make participation feel natural rather than automated.

---

## 31.2 Default Group Cooldown

The default configuration should be:

GROUP_COOLDOWN_MS=15000

This equals:

15 seconds

The cooldown is applied per group.

It must NOT be one global cooldown for the entire WhatsApp account.

---

## 31.3 Why 15 Seconds?

15 seconds gives the group enough time to continue naturally after the AI speaks.

Example:

John:
BTC is moving 😂

AI:
Omo this market no dey rest 😂

David:
For real.

Peter:
I just checked too.

The AI should normally allow the conversation to continue rather than immediately sending another unsolicited message.

---

## 31.4 Per-Group Cooldown

Use:

groupJid

as the cooldown key.

Example:

Group A
last AI response: 10:00:00
cooldown until: 10:00:15

Group B
last AI response: 10:00:00
cooldown until: 10:00:15

The activity in Group A must not block Group B.

---

## 31.5 Basic Cooldown Logic

Conceptually:

const GROUP_COOLDOWN_MS = 15000;

function isGroupOnCooldown(groupJid: string) {
  const lastResponse = getLastAIResponse(groupJid);

  if (!lastResponse) {
    return false;
  }

  return Date.now() - lastResponse < GROUP_COOLDOWN_MS;
}

The actual implementation should use the application's database/cache rather than relying only on process memory.

---

## 31.6 Cooldown Is NOT an Absolute Block

The cooldown should not prevent important interactions.

There should be different priority levels.

LOW
NORMAL
HIGH
CRITICAL

---

## 31.7 LOW Priority

Examples:

"lol 😂"

"Na wa"

"Guy 😂"

"This thing funny"

If the AI recently replied, it should usually stay silent.

LOW
 ↓
Cooldown active
 ↓
IGNORE

---

## 31.8 NORMAL Priority

Examples:

"What's this?"

"Who knows about this?"

"How does this work?"

If the AI recently replied:

NORMAL
 ↓
Cooldown active
 ↓
Usually wait

If the conversation moves on and the message remains relevant, the AI can respond later.

---

## 31.9 HIGH Priority

Examples:

@AI what's BTC price now?

[Reply to AI]
"Explain this."

AI, search this for me.

AI send me a meme.

These should be allowed to bypass or greatly reduce the normal cooldown.

Example:

HIGH PRIORITY
      ↓
Cooldown active
      ↓
Allow response

---

## 31.10 Direct Reply to AI

If a group member directly replies to the AI's message:

AI:
BTC is moving up.

John:
[Reply to AI]
Why?

The AI should respond quickly.

Recommended response delay:

0–3 seconds

The 15-second general cooldown should NOT prevent this.

---

## 31.11 Direct Mention

Example:

John:
@AI what's happening?

This is a direct request.

The AI should prioritize it.

Recommended delay:

0–3 seconds

depending on the configured human-like response timing.

---

## 31.12 Mention of Another Member

Example:

John:
@David you know this one?

The AI should not automatically join just because someone was mentioned.

It should determine whether its participation adds value.

---

## 31.13 Mention-All

Mention-all is much more sensitive.

It should have its own cooldown.

Recommended default:

GROUP_MENTION_ALL_COOLDOWN_MS=1800000

That equals:

30 minutes

The AI should almost never use mention-all casually.

---

## 31.14 Recommended Timing Configuration

Default:

GROUP_COOLDOWN_MS=15000

DIRECT_REPLY_DELAY_MS=1000
DIRECT_REPLY_MAX_DELAY_MS=3000

DIRECT_MENTION_DELAY_MS=1000
DIRECT_MENTION_MAX_DELAY_MS=3000

GROUP_MENTION_ALL_COOLDOWN_MS=1800000

The exact delay can be randomized within the configured range.

---

## 31.15 Human-Like Delay

Do not always respond exactly 15 seconds later.

The 15-second value is a cooldown, not a forced response delay.

Example:

Message arrives
     ↓
AI decides to respond
     ↓
Human-like delay
     ↓
Send response

Possible delay:

## 1.8 sec
## 4.2 sec
## 7.1 sec
## 2.6 sec

depending on message complexity and priority.

---

## 31.16 Don't Make the AI Artificially Slow

Do NOT make a simple direct question wait 15 seconds just because:

GROUP_COOLDOWN_MS=15000

Cooldown and response delay are separate concepts.

COOLDOWN
=
How soon the AI is allowed to participate again.

RESPONSE DELAY
=
How long the AI waits before sending a response.

---

## 31.17 Adaptive Cooldown

The system should eventually support adaptive behavior.

Example:

Quiet group
    ↓
AI can participate normally

Very active group
    ↓
AI becomes less intrusive

For a rapidly moving conversation:

John:
😂

David:
😂😂

Peter:
Omo

Sarah:
This guy is finished

AI:
😂

The AI should not keep inserting messages into the conversation.

---

## 31.18 Conversation Burst Detection

Track recent message activity.

Example:

messages in last 10 seconds = 2

Normal activity.

But:

messages in last 10 seconds = 20

High activity.

The AI should become more selective during high-volume conversations.

---

## 31.19 Activity Levels

Recommended:

LOW_ACTIVITY
NORMAL_ACTIVITY
HIGH_ACTIVITY
EXTREME_ACTIVITY

Example:

LOW_ACTIVITY
→ normal participation

NORMAL_ACTIVITY
→ normal participation

HIGH_ACTIVITY
→ require stronger reason to reply

EXTREME_ACTIVITY
→ mostly direct mentions/replies only

---

## 31.20 Adaptive Participation

Example:

Group is quiet
       ↓
AI sees useful question
       ↓
Reply

Busy group:

Group has 30 messages in 15 seconds
       ↓
AI sees ordinary conversation
       ↓
Stay silent

But:

@AI what's the current BTC price?

should still trigger a response.

---

## 31.21 Cooldown Should Not Affect Incoming Processing

Even if the group is on cooldown, the system should still receive and understand messages.

Do NOT do:

Cooldown active
→ stop reading messages

Instead:

Message
 ↓
Understand
 ↓
Store
 ↓
Update conversation context
 ↓
Decision engine
 ↓
Cooldown check
 ↓
Maybe respond

This is important for learning.

---

## 31.22 Memory During Cooldown

Messages received during cooldown should still contribute to group understanding.

Example:

John:
BTC might crash.

David:
I don't think so.

Peter:
Let's see.

AI:
[Silent]

The AI still understands:

Current topic = BTC
Opinions = disagreement
Conversation active = yes

It simply chooses not to interrupt.

---

## 31.23 Cooldown and Web Search

If a user directly asks:

@AI
What's BTC price now?

the AI can bypass the normal cooldown.

Pipeline:

Mention
 ↓
High priority
 ↓
Search required
 ↓
Tavily
 ↓
Verify
 ↓
Reply

---

## 31.24 Cooldown and Media Requests

Example:

John:
@AI send meme 😂

This should be treated as a direct request.

The system may bypass the normal cooldown:

Mention
 ↓
Media request
 ↓
Search
 ↓
Download
 ↓
Send

---

## 31.25 Cooldown and Voice Notes

If a group member sends a voice note directly to the AI or replies to it:

Voice note
 ↓
Transcription
 ↓
Intent detection
 ↓
High priority if directed at AI

Normal cooldown should not unnecessarily block the response.

---

## 31.26 Cooldown and Tasks

If a user requests an explicit task:

@AI remind me at 8pm

the task engine should process it independently of the group cooldown.

Cooldown controls conversational participation.

It should not block important application actions.

---

## 31.27 Duplicate Messages

Cooldown must work together with duplicate protection.

Example:

WhatsApp event
 ↓
Message ID already processed?
 YES
 ↓
IGNORE

Do not allow duplicate events to create multiple AI responses.

---

## 31.28 Multiple Messages From Same User

Example:

John:
Bro

John:
Look at this

John:
😂😂😂

Do not necessarily produce three AI replies.

The AI should combine recent messages into one conversational context.

Possible:

John:
Bro look at this 😂

then one response.

---

## 31.29 Multiple Users During Cooldown

Example:

AI:
That's wild 😂

John:
For real

David:
No way

Peter:
I saw it too

Sarah:
Same

The AI should generally remain silent.

The group does not need another AI message.

---

## 31.30 Cooldown Expiration

After:

15 seconds

the AI is allowed to participate again.

But expiration does NOT mean:

AUTOMATICALLY RESPOND

It means:

AI MAY RESPOND IF THE DECISION ENGINE THINKS IT SHOULD.

---

## 31.31 Cooldown State

Recommended:

interface GroupActivityState {
  groupJid: string;

  lastAIResponseAt?: number;

  cooldownUntil?: number;

  messagesLast10Seconds: number;

  messagesLast30Seconds: number;

  messagesLast5Minutes: number;

  activityLevel:
    | "LOW"
    | "NORMAL"
    | "HIGH"
    | "EXTREME";
}

---

## 31.32 Database / Cache

High-frequency cooldown data should preferably use a fast cache such as Redis if available.

Persistent analytics can be stored in PostgreSQL.

Architecture:

WhatsApp
   ↓
Message Worker
   ↓
Redis
   │
   ├── cooldown
   ├── rate limits
   └── activity counters
   ↓
PostgreSQL
   │
   └── persistent history

If Redis is unavailable, the system should have a safe fallback.

---

## 31.33 Race Condition Protection

Two messages can arrive almost simultaneously.

Example:

Message A
Message B

Two workers may both decide:

AI can respond

This could result in two AI responses.

Use an atomic lock or transaction.

Example concept:

Acquire group response lock
        ↓
Check cooldown
        ↓
Generate/queue response
        ↓
Update cooldown
        ↓
Release lock

---

## 31.34 Cooldown Lock

The lock should be short-lived and have an expiration to prevent deadlocks.

Example conceptual key:

ai:group:cooldown:<groupJid>

Do not expose internal cache keys to users.

---

## 31.35 Per-Group Configuration

The dashboard should allow:

Group Cooldown:
[ 15 seconds ]

Optional advanced settings:

Direct mention bypass:
[ ON ]

Reply-to-AI bypass:
[ ON ]

Adaptive activity:
[ ON ]

Mention-all cooldown:
[ 30 minutes ]

---

## 31.36 Recommended Defaults

Use these defaults:

GROUP_COOLDOWN_MS=15000

DIRECT_REPLY_BYPASS=true

DIRECT_MENTION_BYPASS=true

ADAPTIVE_ACTIVITY=true

GROUP_MENTION_ALL_COOLDOWN_MS=1800000

These are defaults and should be configurable from the dashboard.

---

## 31.37 Recommended Behavior

The AI should behave approximately like this:

Normal group message
        ↓
Is AI relevant?
        ↓
NO → IGNORE

YES
 ↓
Cooldown active?
 ↓
YES → Is it high priority?
          ↓
        NO → WAIT/IGNORE
          ↓
        YES → RESPOND

NO
 ↓
RESPOND

---

## 31.38 Human-Like Participation Principle

The objective is NOT:

Make AI respond as much as possible.

The objective is:

Make AI participate when its participation feels natural and useful.

Sometimes the most human response is:

No response.

---

## 31.39 Final Configuration

# General group cooldown
GROUP_COOLDOWN_MS=15000

# Direct interactions
DIRECT_REPLY_BYPASS=true
DIRECT_MENTION_BYPASS=true

# Human-like timing
DIRECT_REPLY_DELAY_MIN_MS=1000
DIRECT_REPLY_DELAY_MAX_MS=3000

DIRECT_MENTION_DELAY_MIN_MS=1000
DIRECT_MENTION_DELAY_MAX_MS=3000

# Adaptive behavior
ADAPTIVE_ACTIVITY=true

# Mention-all protection
GROUP_MENTION_ALL_COOLDOWN_MS=1800000

---

## 31.40 Chapter 31 Acceptance Criteria

☐ Default group cooldown = 15 seconds
☐ Cooldown is per group
☐ Cooldown does not block other groups
☐ Direct replies can bypass cooldown
☐ Direct mentions can bypass cooldown
☐ Mention-all has separate cooldown
☐ Cooldown is separate from response delay
☐ Adaptive activity detection
☐ High-volume conversation protection
☐ Messages continue being processed during cooldown
☐ Memory continues updating during cooldown
☐ Duplicate message protection
☐ Race-condition protection
☐ Cooldown state stored safely
☐ Dashboard configuration
☐ Emergency configuration support
☐ Natural participation prioritized over message volume

END OF CHAPTER 31