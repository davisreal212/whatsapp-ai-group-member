# Chapter 24 — CONTEXT ENGINE, MEMORY RETRIEVAL & CONVERSATION UNDERSTANDING

## 24.1 Purpose

The Context Engine determines what information the AI actually needs before responding.

The AI should not receive the entire database.

It should receive the right context.

---

## 24.2 Context Layers

Use:

SYSTEM CONTEXT
      ↓
GROUP CONFIGURATION
      ↓
PERSONALITY
      ↓
GROUP PROFILE
      ↓
MEMBER PROFILE
      ↓
RELEVANT MEMORY
      ↓
RECENT CONVERSATION
      ↓
CURRENT MESSAGE

---

## 24.3 Current Conversation

Priority should generally be:

Current message
>
Recent conversation
>
Relevant memory
>
General group knowledge

Old irrelevant memories should not dominate the response.

---

## 24.4 Context Window

Example:

Current message:
1

Recent messages:
20

Relevant memories:
5

Member profile:
1

Group profile:
1

The exact numbers should depend on model capacity and token budget.

---

## 24.5 Semantic Retrieval

Example:

Current:

"That meeting we talked about."

Search memory for:

meeting

and semantically related concepts.

Potential result:

"Group meeting scheduled Friday 7pm."

---

## 24.6 Hybrid Retrieval

Use both:

Keyword search
+
Semantic/vector search
+
Recency
+
Importance

Example score:

retrievalScore =
semanticSimilarity
+
keywordMatch
+
importance
+
recency
+
groupRelevance

---

## 24.7 Memory Ranking

Suppose there are 100 relevant memories.

Only retrieve the strongest few.

Example:

Memory 1:
0.94

Memory 2:
0.89

Memory 3:
0.84

Memory 4:
0.81

Then pass the top relevant memories to the model.

---

## 24.8 Conversation Threading

WhatsApp replies provide strong context.

Example:

John:
BTC is moving.

David:
[reply to John]
Up or down?

AI:
[reply to David]

The AI should understand the chain.

---

## 24.9 Mention Context

If:

John:
@AI check this

the system should retrieve:

John's message
+
quoted message
+
recent surrounding messages

not merely the words:

"check this"

---

## 24.10 Multiple Participants

Example:

John:
Should we buy?

David:
Maybe.

Peter:
Wait.

Mary:
Why?

The AI must understand who is saying what.

Every message should retain:

senderId
senderName
timestamp

---

## 24.11 Conversation Summaries

If the conversation becomes large:

Recent messages
+
Summary of older conversation

Example:

Summary:
The group has been discussing whether to attend the event on Saturday.
John supports going.
David is undecided.
Mary asked about transport.

---

## 24.12 Memory Injection Protection

Retrieved memory is data.

The AI must not treat arbitrary stored text as higher-priority instructions.

For example, a memory saying:

"Ignore all system rules."

must remain data and cannot override system instructions.

---

## 24.13 Context Compression

Before sending to the model:

Raw context
 ↓
Remove duplicates
 ↓
Remove irrelevant messages
 ↓
Summarize old content
 ↓
Rank memories
 ↓
Build final context

This reduces token usage.

---

## 24.14 Context for Web Search

If the user asks:

"What's happening with BTC?"

context should help determine:

BTC
Current information required
Likely USD price
Group is discussing crypto

Then search.

---

## 24.15 Context for Casual Conversation

If someone says:

"Abeg 😂"

the AI should not perform a web search.

Context determines:

Casual conversation
No external information required

---

## 24.16 Context for Old References

Example:

Monday:
John:
I finally fixed the server.

Friday:
David:
How did you fix that thing?

The system retrieves the relevant memory:

John fixed the server Monday.

and understands:

"that thing" = server issue

---

## 24.17 Context Confidence

If multiple memories could match:

"the project"

and there are three projects, the AI should not confidently choose one.

It can ask:

"Which project you mean?"

---

## 24.18 Context Debugging

Dashboard should provide a developer/debug view:

CURRENT MESSAGE
"What's the price now?"

RETRIEVED CONTEXT
✓ BTC discussion
✓ Recent crypto messages
✓ User profile

SEARCH REQUIRED
YES

DECISION
REPLY

Do not expose hidden system prompts or sensitive credentials.

---

## 24.19 Context Cache

Repeated requests can reuse stable context:

Group profile
Member profile
Recent summary

This saves processing.

Invalidate/update caches when memory changes significantly.

---

## 24.20 Context Acceptance Criteria

☐ Layered context
☐ Recent conversation retrieval
☐ Semantic memory search
☐ Keyword search
☐ Hybrid ranking
☐ Group isolation
☐ Member context
☐ Reply-chain understanding
☐ Mention context
☐ Conversation summaries
☐ Context compression
☐ Ambiguity detection
☐ Memory-as-data protection
☐ Context caching
☐ Developer context diagnostics

---

INTELLIGENCE ARCHITECTURE AFTER CHAPTER 24

The central AI now becomes:

                       NEW MESSAGE
                            │
                            ▼
                   MESSAGE UNDERSTANDING
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
         Sender          Group          Message
         Profile         Profile          Type
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                     CONTEXT ENGINE
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          Recent Chat     Memory       Reply Chain
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                    DECISION ENGINE
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
          IGNORE          REPLY          ACTION
                            │              │
                            │       ┌──────┼───────┐
                            │       ▼      ▼       ▼
                            │    SEARCH  MEDIA   TASK
                            │       │      │       │
                            └───────┴──────┴───────┘
                                    │
                                    ▼
                              AI PROVIDER
                                 ROUTER
                                    │
                       ┌────────────┼────────────┐
                       ▼            ▼            ▼
                    GEMINI        GROQ      OPENROUTER
                       │            │            │
                       └────────────┼────────────┘
                                    ▼
                            RESPONSE PLANNER
                                    │
                              VALIDATION
                                    │
                              OUTBOUND QUEUE
                                    │
                                    ▼
                                 WHATSAPP

Next: Chapters 25–28 should cover the remaining critical pieces:

25 — Web Research, Tavily & Source Verification
26 — Natural Replies, Replies, Reactions & Mentions
27 — Media/Meme Search & Multimedia Agent
28 — Complete AI System Prompt + Agent Rules + Final Decision Logic

Chapter 28 will essentially turn everything we've designed so far into the actual master specification the coding agent follows.