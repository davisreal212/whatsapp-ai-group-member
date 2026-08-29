# Chapter 4 — GROUP DISCOVERY, AUTHORIZATION & GROUP MANAGEMENT

## 4.1 Purpose

After WhatsApp is connected, the system must discover groups and allow the administrator to decide exactly where the AI can operate.

The fundamental rule is:

«Membership does not equal authorization.»

If the WhatsApp account belongs to ten groups, the AI should not automatically operate in all ten.

---

## 4.2 Group Discovery

After connection:

WhatsApp Connected
      ↓
Request group metadata
      ↓
Receive groups
      ↓
Normalize group information
      ↓
Store/update database
      ↓
Dashboard displays groups

Example:

GROUPS FOUND

12 total

Crypto Boys
AI Project
Family
School
Football
Friends
...

---

## 4.3 Group Database Record

Each group should have at least:

id
whatsapp_group_id
subject
description
participant_count
is_enabled
ai_paused
personality_override
web_search_enabled
voice_enabled
media_enabled
memory_enabled
created_at
updated_at
last_seen_at

---

## 4.4 Default State

Every newly discovered group must default to:

AI ENABLED = FALSE

This is extremely important.

When a new group appears:

New group
   ↓
Database
   ↓
Enabled = FALSE
   ↓
AI ignores group

Only the administrator can activate it.

---

## 4.5 Group Selection Dashboard

The dashboard should show:

┌────────────────────────────────────────────┐
│ GROUPS                                     │
├────────────────────────────────────────────┤
│                                            │
│ ☑ Crypto Boys             AI ON            │
│                                            │
│ ☑ AI Project              AI ON            │
│                                            │
│ ☐ Family                  AI OFF           │
│                                            │
│ ☐ School                  AI OFF           │
│                                            │
│ ☐ Random Group            AI OFF           │
│                                            │
└────────────────────────────────────────────┘

The administrator can enable/disable each group.

---

## 4.6 Hard Authorization Boundary

Every incoming WhatsApp message must pass this check:

Is group?
     ↓
YES
     ↓
Is group in database?
     ↓
YES
     ↓
Is group enabled?
     ↓
YES
     ↓
Is AI currently active?
     ↓
YES
     ↓
Continue processing

If any answer is NO:

STOP

No LLM.

No memory processing.

No web search.

No response.

---

## 4.7 DM Protection

When group-only mode is enabled:

Incoming DM
     ↓
Message classifier
     ↓
isGroup = false
     ↓
DROP

Do not send the DM to:

- Gemini.
- Groq.
- OpenRouter.
- Tavily.
- Memory.
- Decision engine.

This must happen at the earliest possible stage.

---

## 4.8 Group-Level Pause

Each group should have:

AI ACTIVE
AI PAUSED

Example:

Crypto Boys

🟢 AI ACTIVE

[ Pause AI ]

When paused:

Incoming messages
       ↓
Observe/record only if configured
       ↓
NO OUTBOUND ACTION

The administrator should be able to resume at any time.

---

## 4.9 Global Pause vs Group Pause

There are two different controls.

Global

PAUSE ALL OUTBOUND ACTIONS

Stops every group.

Group

PAUSE THIS GROUP

Stops only that group.

The global pause always takes priority.

Global pause = ON
        ↓
No outbound action anywhere

---

## 4.10 Group Settings

Each enabled group should have its own settings.

Example:

GROUP: CRYPTO BOYS

AI
[ ON ]

Personality
[ Default ]

Talkativeness
[ Medium ]

Humor
[ High ]

Web Search
[ ON ]

Voice
[ ON ]

Memes
[ ON ]

Memory
[ ON ]

Response cooldown
[ 20 sec ]

Maximum AI messages/hour
[ configurable ]

---

## 4.11 Group Personality Overrides

There should be a global personality.

Then each group can override it.

Example:

GLOBAL PERSONA
Casual + funny

CRYPTO GROUP
More analytical

FRIENDS GROUP
More playful

PROJECT GROUP
More professional

The group override should take precedence over global defaults.

---

## 4.12 Group Culture Model

Every enabled group should eventually have a learned profile.

Example:

GROUP CULTURE

Language:
English + Nigerian Pidgin

Humor:
High

Message style:
Short

Emoji frequency:
High

Common topics:
Crypto
Football
Music

Conversation style:
Fast-moving

Observed etiquette:
Members frequently joke with one another.

This profile should not be manually hard-coded.

It should be gradually learned from messages.

---

## 4.13 Group Culture Must Have Confidence

The system must not conclude:

"This group loves football."

because somebody mentioned football once.

Instead:

Observation:
Football appears frequently.

Evidence:
47 relevant messages.

Confidence:
0.87

Repeated evidence can increase confidence.

Old/unconfirmed observations should decay.

---

## 4.14 Group Topics

Track topics that appear repeatedly.

Example:

CURRENT GROUP TOPICS

1. BTC
2. Football
3. Music
4. AI

Topics should have:

topic
frequency
recent_activity
confidence

This helps the AI understand what is happening without sending the entire historical message database to the LLM.

---

## 4.15 Active Conversation Threads

Multiple conversations can happen simultaneously.

Example:

John:
BTC looking crazy

Mary:
Who watched Arsenal?

David:
That new AI model is insane

The system should recognize these as potentially different topics.

Do not combine all three into one meaningless conversation summary.

Use topic/thread segmentation where possible.

---

## 4.16 Group Activity Patterns

The system can learn:

Typical active hours
Typical message frequency
Typical response speed
Most active members
Common conversation periods

This can help the AI behave naturally.

For example, a group that normally has rapid-fire messages should not have the AI wait several minutes before every reply.

---

## 4.17 Group Member Discovery

When a group is enabled:

Group
 ↓
Get participants
 ↓
Normalize members
 ↓
Store member records

Each member should have:

member_id
group_id
display_name
whatsapp_participant_id
first_seen
last_seen
behavior_profile
confidence

---

## 4.18 Member Identity

Never rely only on display names.

A display name can change.

Use the WhatsApp participant identifier as the stable identity.

Example:

Member:
John

WhatsApp ID:
stable-participant-id

The dashboard can show:

John

but the backend should use:

stable participant ID

for mentions, replies and task ownership.

---

## 4.19 Member Behavioral Intelligence

The system should gradually learn communication behavior.

Possible observations:

message length
language style
Pidgin usage
emoji frequency
frequent topics
humor style
response patterns
whether they often initiate conversations
whether they often reply

Do not infer unnecessary sensitive characteristics.

The purpose is to understand how the person communicates with the AI.

---

## 4.20 Relationship Intelligence

The system can observe interaction patterns.

Example:

John ↔ David

Frequent replies
High banter
Repeated jokes

This can help interpret context.

But relationships should be represented as probabilistic observations.

Never treat:

"John and David are best friends"

as a confirmed fact simply because they joke frequently.

---

## 4.21 Chapter 4 Acceptance Criteria

Before moving forward:

☐ WhatsApp groups are discovered
☐ Groups are stored
☐ New groups default to disabled
☐ Administrator can enable groups
☐ Administrator can disable groups
☐ Group settings work independently
☐ Group-level pause works
☐ Global pause overrides group settings
☐ DMs are rejected before AI processing
☐ Unapproved groups are rejected
☐ Member records are created
☐ Stable WhatsApp participant IDs are used
☐ Group culture storage exists
☐ Group topic storage exists
☐ Group activity metrics exist

---

