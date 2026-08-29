# Chapter 1

PRODUCT VISION, SCOPE & CORE ARCHITECTURE

## 1.1 What We Are Building

We are building an AI social agent that operates inside selected WhatsApp groups through an unofficial WhatsApp Web/linked-device integration.

The important distinction is:

This is not simply a chatbot connected to WhatsApp.

The goal is to build something that behaves more like an actual human member of a group.

The AI should be able to:

- Observe conversations.
- Understand what is happening.
- Understand the personalities and communication styles of group members.
- Learn the culture of each group.
- Remember relevant previous conversations.
- Decide when to speak.
- Decide when NOT to speak.
- Reply to messages.
- Reply directly to quoted/replied messages.
- Detect when it has been mentioned.
- Mention specific members when appropriate.
- React to messages where supported.
- Search the web when information needs verification.
- Listen to voice notes.
- Understand images where supported.
- Send text.
- Send audio.
- Search for memes/images.
- Remember requests and create future tasks.
- Notify members when a condition they requested is met.
- Adapt its personality through configuration.
- Continue conversations naturally.

The AI should feel like a participant in the group, not like an automated customer-support system.

---

## 1.2 The Most Important Principle

The single most important behavioral rule is:

«THE AI MUST UNDERSTAND BEFORE IT SPEAKS.»

A message arriving does not automatically mean the AI should reply.

For example:

John:
"Guy this match crazy 😂"

Mary:
"For real 😂"

David:
"That second goal though!"

AI:
[stays silent]

Silence is the correct behavior.

The AI should not feel obligated to participate in every conversation.

However:

John:
"@AI what do you think?"

AI:
[considers response]

Now the AI has a strong reason to participate.

Likewise:

John:
"@AI you said yesterday that BTC was going to move 😂"

Because the AI has been directly mentioned and the message references previous conversation, the AI should load relevant context and respond.

---

## 1.3 The AI Has Four Main Sources of Understanding

The AI's behavior should be based on four different types of information.

A. Current conversation

What is happening right now?

Example:

John: Who watched the match?
Mary: Me 😂
David: That ending was mad
John: @AI

The AI should understand that the conversation is about the match before answering John.

---

B. Short-term memory

Recent messages and conversation context.

This allows the AI to understand things such as:

John:
"Remember that thing I told you?"

AI:
[loads recent context]

The AI should not need the entire group's history every time.

Only relevant context should be retrieved.

---

C. Long-term group intelligence

The AI gradually learns the characteristics of the group.

For example:

GROUP PROFILE

Language:
English + Nigerian Pidgin

Humor:
High

Typical conversation:
Casual

Common topics:
Crypto
Football
Music
Technology

Typical active period:
Evening

Group culture:
Heavy banter
Frequent emojis
Short messages
Members commonly tease each other

This information should be learned from repeated observations rather than invented.

---

D. Member behavioral intelligence

The AI should gradually understand how individual members communicate.

For example:

MEMBER: John

Communication observations:
- Frequently uses Pidgin
- Usually sends short messages
- Frequently uses 😂
- Often starts crypto conversations
- Usually jokes when asking questions
- Often replies to other members

These are behavioral observations.

The system must NOT attempt to infer sensitive personal characteristics that are unnecessary for operating the bot.

---

## 1.4 The AI Must Understand That Different Groups Are Different Worlds

The same WhatsApp account may belong to multiple groups.

The AI must never treat all groups as one conversation.

For example:

GROUP A
Crypto discussion
Serious
Technical

GROUP B
Friends
Very casual
Heavy banter

GROUP C
Project
Professional
Short responses

The AI's behavior should adapt to each group.

A joke appropriate in Group B may be inappropriate in Group C.

Therefore every group needs its own:

- Conversation context.
- Group memory.
- Culture model.
- Enabled/disabled state.
- Personality overrides.
- Activity information.
- Member relationships.
- AI behavior configuration.

---

## 1.5 Group-Only Operation

The default operating mode must be:

«GROUPS ONLY.»

Private WhatsApp conversations must not be processed by the AI when group-only mode is enabled.

The filtering must happen BEFORE expensive AI processing.

Correct architecture:

Incoming WhatsApp event
        ↓
Is this a group?
        │
        ├── NO → IGNORE
        │
        └── YES
             ↓
       Is group enabled?
             │
        ┌────┴────┐
        │         │
       NO        YES
        │         │
     IGNORE       ↓
             Continue

Do NOT do:

DM
 ↓
Gemini
 ↓
AI decides to ignore

That wastes AI quota and unnecessarily processes private messages.

Instead:

DM
 ↓
LOCAL POLICY FILTER
 ↓
DROP

No Gemini call.

No Groq call.

No OpenRouter call.

No Tavily search.

No memory processing.

---

## 1.6 Explicit Group Allowlist

Being a member of a WhatsApp group does not automatically give the AI permission to operate there.

The administrator must explicitly enable groups.

Example dashboard:

YOUR WHATSAPP GROUPS

☑ Crypto Boys
☐ Family
☑ AI Project
☐ School
☐ Random Group

Only:

Crypto Boys
AI Project

are active.

If the WhatsApp account is later added to another group:

New Group
     ↓
Discovered
     ↓
NOT automatically enabled
     ↓
AI remains silent

This is an important security boundary.

---

## 1.7 The AI Is an Agent, Not Just a Text Generator

The AI should be able to make decisions about actions.

Possible actions include:

IGNORE
REACT
REPLY
REPLY_TO_MESSAGE
MENTION_REPLY
SEND_IMAGE
SEND_MEME
SEND_AUDIO
SEARCH_WEB
SEARCH_IMAGE
CREATE_TASK
UPDATE_TASK

The AI should never directly execute these actions.

Instead:

AI
 ↓
ActionPlan
 ↓
Server-side validation
 ↓
Action executor
 ↓
WhatsApp

Example:

{
  "action": "REPLY_TO_MESSAGE",
  "targetMessageId": "ABC123",
  "text": "😂 I was thinking the same thing",
  "delayMs": 3500
}

The server then verifies:

1. The target message exists.
2. The target belongs to an enabled group.
3. The action is permitted.
4. The bot is not paused.
5. Rate limits allow the action.
6. The action has not already been executed.

Only then should the WhatsApp adapter send it.

---

## 1.8 Human-Like Does Not Mean Random

The system should not randomly delay messages or randomly ignore people just to appear human.

Human-like behavior should come from understanding context.

For example:

Situation A

Someone directly asks the AI:

@AI what is BTC price now?

Response probability:

Very high.

---

Situation B

Someone says:

BTC looking crazy today 😂

The AI may decide:

No direct question.
No useful contribution required.
Stay silent.

---

Situation C

Someone replies directly to the AI:

AI: BTC is volatile today.

John: Why you think so?

Now the AI should recognize:

Reply to AI = strong response signal

and continue the conversation.

---

## 1.9 Decision Engine

Before generating a response, the AI should evaluate signals.

Conceptually:

                         MESSAGE
                            ↓
                   ┌─────────────────┐
                   │ MESSAGE ANALYSIS │
                   └────────┬────────┘
                            ↓
              ┌──────────────────────────┐
              │ Is AI directly mentioned?│
              └────────────┬─────────────┘
                           ↓
              ┌──────────────────────────┐
              │ Is this a reply to AI?   │
              └────────────┬─────────────┘
                           ↓
              ┌──────────────────────────┐
              │ Is there a relevant      │
              │ question/request?        │
              └────────────┬─────────────┘
                           ↓
              ┌──────────────────────────┐
              │ Has someone already      │
              │ answered?                │
              └────────────┬─────────────┘
                           ↓
              ┌──────────────────────────┐
              │ Would speaking naturally │
              │ fit the conversation?    │
              └────────────┬─────────────┘
                           ↓
                    DECISION
                  /           \
             RESPOND          IGNORE

This decision can combine deterministic rules with AI classification.

Deterministic rules should handle obvious cases.

An LLM should handle ambiguous social situations.

---

## 1.10 Web Research Is a Core Capability

The AI must not rely on its training knowledge for information that changes over time.

Examples requiring current research:

- Current cryptocurrency prices.
- Breaking news.
- Sports results.
- Current company announcements.
- Current product specifications.
- Current software versions.
- Current listings.
- Recent political/government announcements.
- "Is this news true?"
- "Did this actually happen?"
- "What's happening today?"

The system should recognize these requests and invoke the Web Research Engine.

---

## 1.11 No Fake Information

This is a strict requirement.

The AI must never manufacture a source, price, event, quote, announcement or statistic.

If the AI cannot verify something:

"I couldn't verify that yet."

is better than:

"Yes, it's confirmed."

when it is not confirmed.

The research pipeline should be:

Question
   ↓
Determine whether web is needed
   ↓
Search
   ↓
Open/read useful sources
   ↓
Identify source quality
   ↓
Compare sources when necessary
   ↓
Build evidence
   ↓
Generate answer

Tavily should be available as an independent web-search/research backup.

---

## 1.12 Voice Notes

Voice notes are first-class input.

Example:

Member sends voice note
        ↓
Download temporary audio
        ↓
Speech-to-text
        ↓
Transcript
        ↓
Message understanding
        ↓
AI decision

The AI should know that the original message was a voice note.

This can influence its response.

For example, a member sends a 45-second voice note asking a complicated question.

The AI may choose:

Audio response

instead of a long text.

For a simple question:

Text response

may be more natural.

If native voice-note sending is unavailable or unreliable, the system should send generated speech as an audio attachment instead.

---

## 1.13 Proactive Tasks

The AI must understand future requests.

Example:

User:
"Bruh once BTC hit 80k abeg let me know @AI"

This means:

Create task:

Type:
PRICE_THRESHOLD

Asset:
BTC

Condition:
>= 80000 USD

Owner:
The requesting member

Group:
Current group

Status:
ACTIVE

The AI should NOT repeatedly call an LLM to check the price.

Instead:

User request
     ↓
Task created
     ↓
Scheduler
     ↓
Data source
     ↓
Condition check
     ↓
Condition reached
     ↓
Notification event
     ↓
Mention requesting member
     ↓
Natural AI notification

Example:

«@John Bruh 😂 BTC just touch 80k. You said I should let you know.»

The wording should depend on personality.

---

## 1.14 Personality System

The dashboard must allow the administrator to configure personality.

Example:

PERSONALITY

Name:
[ Nova ]

Presentation:
[ Female ]

Tone:
[ Casual ]

Humor:
[ High ]

Talkativeness:
[ Medium ]

Initiative:
[ Medium ]

Emoji:
[ High ]

Language:
[ English + Pidgin ]

Response length:
[ Short ]

Web research:
[ Enabled ]

Voice:
[ Enabled ]

Personality should affect:

- Vocabulary.
- Response length.
- Humor.
- Emoji use.
- Initiative.
- Formality.
- Language style.
- Voice selection.
- Whether it tends to react or reply.

However:

Personality must never override security, group authorization or truthfulness.

---

## 1.15 Dashboard Concept

The dashboard is the control center.

Primary navigation:

Dashboard
│
├── Overview
├── WhatsApp
├── Groups
├── Members
├── Personality
├── Memory
├── AI Providers
├── Web Research
├── Voice & Media
├── Tasks
├── Logs
└── Settings

The overview should show:

WhatsApp
🟢 Connected

Enabled groups
3

Members observed
87

AI provider
Gemini

Fast provider
Groq

Fallback
OpenRouter

Web research
🟢 Tavily

Voice
🟢 Enabled

Active tasks
5

---

## 1.16 Provider Architecture

AI providers must be interchangeable.

Conceptually:

                    AI REQUEST
                        ↓
                  PROVIDER ROUTER
                        │
          ┌─────────────┼─────────────┐
          ↓             ↓             ↓
       GEMINI          GROQ       OPENROUTER
      PRIMARY          FAST         FALLBACK

The system should not contain Gemini-specific logic throughout the application.

Instead:

AIService
   ↓
ProviderRouter
   ↓
GeminiProvider
GroqProvider
OpenRouterProvider

This allows providers to be changed without rewriting the entire application.

---

## 1.17 Web Provider Architecture

Web search should similarly be abstracted.

ResearchService
       ↓
ResearchProvider
       │
       ├── Provider-native search
       │
       └── Tavily

If the primary search system fails:

Primary search
     ↓
FAILED
     ↓
Tavily
     ↓
Search

If both fail:

No reliable current evidence
        ↓
Tell user that verification failed

Do not fall back to fabricated information.

---

## 1.18 Memory Must Be Selective

The system should NOT remember every message forever.

Memory should be divided into layers.

SHORT-TERM
Recent conversation
       ↓
GROUP MEMORY
Culture / topics / norms
       ↓
MEMBER MEMORY
Communication behavior
       ↓
RELATIONSHIP MEMORY
Interaction patterns
       ↓
TASK MEMORY
Reminders / conditions

Each memory should have:

confidence
evidence count
created time
last confirmed time
expiration where appropriate

This prevents one random message from permanently changing the AI's understanding of someone.

---

## 1.19 The AI Must Be Able to Forget

Information changes.

For example:

Member previously:
"Usually talks about football."

Months later:
No football conversations.
Mostly talks about technology.

The model should gradually update its confidence.

Memory should decay when not confirmed.

Temporary facts should have shorter expiration times.

Stable behavioral observations can persist longer.

The dashboard should allow:

Reset member memory
Delete member memory
Reset group memory
Delete group memory
Clear all learned data

---

## 1.20 Learning Must Not Modify the Program

The AI is allowed to learn:

group culture
communication patterns
member behavior
conversation context
useful preferences
task history

It must NOT autonomously learn by changing:

source code
security rules
administrator permissions
API keys
WhatsApp authorization
system policies

Learning changes data and context, not executable authority.

---

## 1.21 Complete System Flow

The entire product should eventually behave approximately like this:

                    WHATSAPP
                       │
                       ▼
                INCOMING EVENT
                       │
                       ▼
               MESSAGE NORMALIZER
                       │
                       ▼
                POLICY FILTER
                       │
          ┌────────────┴────────────┐
          │                         │
       REJECT                    ACCEPT
          │                         │
        STOP                        ▼
                            CONTEXT ENGINE
                                  │
                                  ▼
                         MEMORY RETRIEVAL
                                  │
                                  ▼
                         DECISION ENGINE
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                  IGNORE                      ACT
                                                │
                                                ▼
                                         TOOL DECISION
                                                │
                         ┌──────────────┬────────┼──────────────┐
                         ▼              ▼        ▼              ▼
                       WEB            MEDIA    TASK          NONE
                         │              │        │
                         └──────────────┴────────┴──────────────┘
                                                │
                                                ▼
                                          AI RESPONSE
                                                │
                                                ▼
                                           ACTION PLAN
                                                │
                                                ▼
                                      POLICY VALIDATION
                                                │
                                                ▼
                                         ACTION QUEUE
                                                │
                                                ▼
                                           WHATSAPP
                                                │
                                                ▼
                                           OUTCOME
                                                │
                                                ▼
                                      LEARNING / MEMORY

---

## 1.22 What We Are NOT Building

The coding agent must not simplify this project into:

WhatsApp → GPT → send response

That is insufficient.

We are also not building:

- An AI that replies to every message.
- An AI that processes private chats by default.
- An AI that blindly trusts search snippets.
- An AI that invents information.
- An AI that permanently profiles users from one message.
- An AI that changes its own permissions.
- An AI that sends uncontrolled messages.
- An AI that burns free-tier API quotas unnecessarily.

---

## 1.23 Engineering Principles

The implementation must follow these principles:

Principle 1 — Safety before intelligence

Authorization and policy filtering happen before AI processing.

Principle 2 — Silence is a valid action

The AI should not maximize message count.

Principle 3 — Evidence before current factual claims

Current information should be verified.

Principle 4 — AI proposes, server validates

LLM output is never trusted as executable authority.

Principle 5 — Memory is probabilistic

Learned observations require confidence and evidence.

Principle 6 — Every group is independent

Group A's culture must not automatically become Group B's culture.

Principle 7 — Providers are replaceable

No provider should be deeply hard-coded into the application.

Principle 8 — Fail safely

When uncertain, broken or unauthorized, the system should prefer doing nothing.

Principle 9 — Quota is a resource

Do local filtering and caching before expensive AI/web operations.

Principle 10 — Build incrementally

Every chapter must leave the project in a testable state.

---

## 1.24 Chapter 1 Acceptance Criteria

Chapter 1 is complete when the coding agent can explain and implement the following architecture without ambiguity:

WhatsApp
   ↓
Normalization
   ↓
Group authorization
   ↓
Context
   ↓
Memory
   ↓
Decision
   ↓
Tools
   ↓
Response/action
   ↓
Validation
   ↓
Execution
   ↓
Learning

The agent must understand that:

1. The AI operates only in explicitly enabled groups.
2. DMs are rejected before AI processing when group-only mode is enabled.
3. The AI decides whether to speak rather than automatically responding.
4. Replies and mentions have higher social priority.
5. Web research is required for appropriate current/factual questions.
6. Tavily is an independent web-search backup.
7. Unsupported facts must never be fabricated.
8. Voice notes are supported as input.
9. Audio can be used as an output fallback.
10. The AI can create future conditional tasks.
11. Group intelligence and member behavioral intelligence are separate concepts.
12. Memory has confidence and expiration.
13. Personality is configurable.
14. AI providers are abstracted.
15. LLM actions are validated server-side.
16. The system has a global emergency stop.
17. Learning changes data, not executable permissions or code.
18. The system is designed as a social agent rather than a simple chatbot.

---

## 1.25 What Chapter 2 Will Build

Chapter 2 should turn this architecture into an actual engineering foundation.

It will define:

- Exact technology stack.
- Backend framework.
- Frontend framework.
- Database.
- Redis/queue requirements.
- Authentication.
- Project repository structure.
- Environment variables.
- Development environment.
- Production environment.
- Service boundaries.
- API conventions.
- Database migration strategy.
- Logging conventions.
- Error-handling conventions.
- TypeScript types/interfaces.
- Initial folder structure.
- Local development commands.
- First health-check endpoint.

At the end of Chapter 2, the project should have a running web application + backend + database foundation, but WhatsApp itself will not yet be connected.