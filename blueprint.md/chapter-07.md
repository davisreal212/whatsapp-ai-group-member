# Chapter 7 — GROUP UNDERSTANDING & LONG-TERM MEMORY

## 7.1 Purpose

The AI should not behave like it entered the group five minutes ago.

It should gradually understand:

- What the group talks about.
- How people communicate.
- Running jokes.
- Common subjects.
- Important recurring events.
- Group language.
- Conversation patterns.
- Previous AI interactions.

The key requirement is:

«The AI learns from the group over time without blindly treating every message as permanent truth.»

---

## 7.2 Memory Layers

Use several layers.

MEMORY
│
├── Group Memory
│
├── Member Memory
│
├── Conversation Memory
│
├── Topic Memory
│
├── Relationship Observations
│
└── Task Memory

---

## 7.3 Group Memory

Examples:

The group frequently discusses cryptocurrency.

Members commonly use Nigerian Pidgin.

Football discussions are common.

The group usually prefers short messages.

The group frequently uses 😂 emojis.

Each observation should have:

content
confidence
evidence_count
first_observed
last_confirmed
last_updated

---

## 7.4 Memory Confidence

Do not store:

"Everyone in this group loves football."

after two messages.

Instead:

Topic:
Football

Evidence:
128 messages

Confidence:
0.94

Confidence grows with repeated evidence.

---

## 7.5 Memory Decay

Information can become outdated.

Example:

Trending topic:
Football

No football discussion for 4 months

Its relevance should gradually decline.

This prevents stale memories from dominating future responses.

---

## 7.6 Memory Categories

Use categories such as:

GROUP_FACT
GROUP_PREFERENCE
GROUP_CULTURE
RUNNING_JOKE
COMMON_TOPIC
MEMBER_PREFERENCE
MEMBER_STYLE
TASK
CONVERSATION_SUMMARY
AI_INTERACTION

---

## 7.7 Important vs Temporary Memory

Not everything deserves permanent memory.

Temporary:

"John said he's tired today."

Long-term:

"John frequently communicates using Nigerian Pidgin."

Potentially permanent only if repeatedly confirmed and useful.

---

## 7.8 Memory Extraction

After suitable conversations:

Messages
 ↓
Memory Extractor
 ↓
Candidate observations
 ↓
Validation
 ↓
Confidence assignment
 ↓
Store/update

The extractor must not blindly save every LLM-generated statement.

---

## 7.9 Memory Deduplication

If the system already knows:

Group frequently discusses BTC.

and another extraction says:

BTC is commonly discussed here.

merge them rather than creating duplicates.

---

## 7.10 Contradictory Memory

If observations conflict:

Observation A:
Group prefers short replies.

Observation B:
Recent conversations contain long technical discussions.

Do not immediately overwrite the first.

Store:

Context:
General conversation → short

Technical discussions:
longer

Memory should become more nuanced.

---

## 7.11 Contextual Memory

Memory retrieval should depend on the current conversation.

If someone asks about:

Arsenal

retrieve:

football-related group memory

Do not retrieve unrelated:

BTC memory
AI project memory
old memes

unless relevant.

---

## 7.12 Semantic Retrieval

Use semantic/vector retrieval if appropriate.

Architecture:

Current message
      ↓
Embedding/retrieval
      ↓
Relevant memories
      ↓
Ranking
      ↓
Context

The implementation should account for embedding costs and free-tier limitations.

A simple keyword/hybrid retrieval system should remain available as a fallback.

---

## 7.13 Memory Privacy

The system should provide memory controls.

Dashboard:

Memory

[ View ]

[ Delete selected ]

[ Clear group memory ]

[ Disable learning ]

The administrator should be able to delete stored memory.

---

## 7.14 Learning Toggle

Each group:

LEARNING

[ ON ]

If disabled:

AI can respond
but does not create new long-term group/member observations.

---

## 7.15 Reset Group Learning

Provide:

[ Reset Group Knowledge ]

This should delete or archive learned group-specific observations according to the configured data policy.

---

## 7.16 Group Knowledge Summary

Dashboard example:

CRYPTO BOYS

Knowledge

Members: 38

Top topics:
• BTC
• Trading
• AI
• Football

Language:
English / Nigerian Pidgin

Conversation style:
Casual

Humor:
High

Average message length:
Short

Learning confidence:
82%

---

