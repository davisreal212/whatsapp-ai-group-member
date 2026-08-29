# Chapter 6 — AI DECISION ENGINE: “SHOULD I SPEAK?”

## 6.1 Purpose

The most important rule of this bot is:

«The AI must not reply to every message.»

A real human in a WhatsApp group does not respond to everything.

Sometimes they:

- Reply.
- React.
- Laugh.
- Tag someone.
- Continue an existing conversation.
- Send a meme.
- Ask a follow-up.
- Search for information.
- Say nothing.

The AI must make the same type of decision.

The system therefore needs a dedicated Decision Engine between incoming messages and the response generator.

Architecture:

Incoming Message
       ↓
Context Builder
       ↓
Memory Retrieval
       ↓
Member Intelligence
       ↓
Group Intelligence
       ↓
Decision Engine
       ↓
┌──────────────┬──────────────┬──────────────┐
│              │              │              │
IGNORE       REACT          REPLY          SEARCH
│              │              │              │
│              │              │              ▼
│              │              │         Research Engine
│              │              │              │
│              └──────────────┴──────────────┘
│                             ↓
│                       Action Planner
│                             ↓
│                        WhatsApp

---

## 6.2 Decision Engine Responsibilities

The Decision Engine determines:

Should the AI do anything?
What should it do?
Who should it respond to?
Should it quote/reply?
Should it mention someone?
Should it search the web?
Should it create a task?
Should it send media?
Should it wait?

It should NOT write the final response itself.

That is the Response Generation layer's responsibility.

---

## 6.3 Possible Actions

The engine should support:

IGNORE

REACT

REPLY

REPLY_TO_MESSAGE

MENTION_REPLY

SEND_IMAGE

SEND_MEME

SEND_AUDIO

SEND_STICKER

SEARCH_AND_REPLY

CREATE_TASK

ASK_CLARIFICATION

More actions can be added later.

---

## 6.4 Priority Signals

The decision engine should consider signals in roughly this order:

1. Safety/policy restrictions
2. Group authorization
3. Direct reply to AI
4. Direct mention of AI
5. Explicit question/request
6. Existing conversation involving AI
7. User task/request
8. Strong relevance to current topic
9. Group culture
10. Member relationship/context
11. Natural conversational opportunity
12. Personality
13. Talkativeness
14. Cooldown/rate limits
15. Randomness within configured boundaries

The exact scoring should remain configurable.

---

## 6.5 Direct Mention

Example:

John:
@AI wetin you think about this?

This is a high-priority signal.

Decision:

DIRECT_MENTION = TRUE

The AI should normally respond unless:

- Group is paused.
- Global outbound actions are paused.
- The request is invalid.
- The system lacks required information.
- A policy restriction applies.
- Rate limits prevent sending.

---

## 6.6 Reply to AI

Example:

AI:
BTC is moving crazy today 😂

John:
Bro why?

Because John directly replied to the AI's message, the system should strongly consider responding.

Signal:

REPLY_TO_AI = TRUE

This is stronger than a normal group message.

---

## 6.7 AI Mentioned in a Conversation

Example:

John:
AI, remember what you said yesterday?

David:
😂😂

Mary:
What did it say?

The AI should understand the conversation chain rather than only looking at the latest message.

The context builder should retrieve:

- AI's previous message.
- John's message.
- Relevant previous messages.
- Member identities.
- Relevant memory.

---

## 6.8 Normal Group Conversation

Example:

John:
Who dey watch Arsenal?

David:
Me 😂

Mary:
You no dey sleep?

David:
Nope.

The AI should usually remain silent.

It should not think:

"I need to participate because there is a conversation."

Instead:

No direct invitation
No question for AI
Low intervention value

→ IGNORE

---

## 6.9 Conversation Opportunity

Sometimes the AI can naturally join without being explicitly tagged.

Example:

John:
This new AI model is crazy.

David:
Have you tested it?

John:
No.

If the AI has strong knowledge about the model, it may decide:

RELEVANCE = HIGH
NATURAL_ENTRY = HIGH

and potentially respond.

However, it should not do this every time.

---

## 6.10 Natural Silence

Silence is a valid AI action.

The system should treat:

IGNORE

as a successful decision, not a failure.

Example:

Message received
↓
Decision
↓
IGNORE
↓
No outbound action

No unnecessary API call should be made for response generation if the decision is already confidently IGNORE.

---

## 6.11 Social Relevance Score

Create an internal score:

socialRelevanceScore

For example:

## 0.00 – 0.20
Ignore

## 0.21 – 0.45
Probably ignore

## 0.46 – 0.65
Possible reaction/reply

## 0.66 – 0.80
Likely reply

## 0.81 – 1.00
Strong reason to respond

These are starting values, not permanent rules.

---

## 6.12 Directness Score

Another useful signal:

directnessScore

Examples:

Normal message:
0.05

Topic relevant:
0.30

Question:
0.65

Mention:
0.90

Reply to AI:
0.95

The final decision combines multiple signals.

---

## 6.13 Existing Answers

The AI must check whether somebody already answered the question.

Example:

John:
What's BTC price?

David:
$79,400

AI:
...

The AI should not unnecessarily repeat:

BTC is $79,400.

Instead it may:

Ignore

or add useful information if appropriate.

---

## 6.14 Avoiding Conversation Hijacking

If two members are having a personal conversation, the AI should generally not interrupt.

Example:

John:
Bro I'll call you later.

David:
No wahala.

Decision:

Conversation relevance = LOW
AI invitation = NONE
→ IGNORE

---

## 6.15 Group Momentum

The system should understand how fast the conversation is moving.

Example:

10 messages in 5 seconds

The AI should avoid inserting a slow, unnecessary paragraph.

Instead, if it responds:

short response

or wait briefly.

---

## 6.16 Delay Before Reply

The AI should support configurable human-like delay.

Do NOT use a fixed delay for every message.

Example:

Simple reaction:
0.5–2 seconds

Short reply:
1–5 seconds

Long response:
3–12 seconds

Web research:
depends on research duration

These are configurable ranges, not promises.

The system should avoid intentionally pretending to be human in contexts where that would be misleading or prohibited. The goal here is natural conversational pacing, not impersonation.

---

## 6.17 Burst Protection

If five messages arrive rapidly:

John:
Bro

John:
Look

John:
At this

John:
😂

John:
This thing

Do not generate five separate AI replies.

Instead:

Message buffer
      ↓
Wait for short settling period
      ↓
Combine relevant messages
      ↓
One decision

---

## 6.18 Decision Example

Input:

John:
@AI once BTC hit 80k abeg let me know.

Decision engine:

Mention = TRUE
Task intent = TRUE
Price threshold = TRUE

ACTION = CREATE_TASK

It should NOT simply respond:

"Okay."

and forget.

The request becomes a structured task.

---

## 6.19 Decision Output

Use a structured object:

interface Decision {
  action:
    | "IGNORE"
    | "REACT"
    | "REPLY"
    | "REPLY_TO_MESSAGE"
    | "MENTION_REPLY"
    | "SEARCH_AND_REPLY"
    | "CREATE_TASK"
    | "SEND_MEDIA";

  confidence: number;

  reasonCodes: string[];

  targetMessageId?: string;

  targetMemberIds?: string[];

  requiresWebSearch?: boolean;

  requiresMemory?: boolean;

  requiresMedia?: boolean;

  delayMs?: number;
}

---

## 6.20 Decision Reason Codes

Example:

DIRECT_MENTION
REPLY_TO_AI
DIRECT_QUESTION
TASK_REQUEST
RELEVANT_TOPIC
HIGH_CONVERSATION_CONTINUITY
LOW_RELEVANCE
ALREADY_ANSWERED
COOLDOWN_ACTIVE
GROUP_PAUSED
GLOBAL_PAUSED

These make the system debuggable.

---

## 6.21 Decision Logging

The dashboard should be able to show:

MESSAGE
"@AI what do you think?"

DECISION
REPLY

REASONS
• Direct mention
• Direct question
• Relevant current topic

CONFIDENCE
94%

For silence:

DECISION
IGNORE

REASONS
• Member-to-member conversation
• No AI invitation
• Low intervention value

This is extremely useful for improving the bot.

---

