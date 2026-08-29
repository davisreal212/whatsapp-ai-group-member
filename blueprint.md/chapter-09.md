# Chapter 9 — WEB SEARCH, RESEARCH & FACT VERIFICATION

## 9.1 Purpose

Web search is one of the most important capabilities.

The AI must not confidently invent current information.

For questions involving changing information, it should research before answering.

Examples:

BTC current price
Latest football result
Current weather
Latest AI model release
Current company information
News
Current exchange rates
Current product prices
Recent events

---

## 9.2 Research Decision

The AI should classify whether web research is necessary.

Example:

"What is 2 + 2?"
→ No search

"What is BTC price right now?"
→ Search

"Who is Einstein?"
→ Usually no search

"Who won yesterday's match?"
→ Search

"What is the latest Gemini model?"
→ Search

---

## 9.3 Research Architecture

User Message
      ↓
Research Classifier
      ↓
Need current information?
      │
      ├── NO → AI
      │
      └── YES
            ↓
      Research Service
            ↓
      Primary Search Provider
            ↓
        Search Results
            ↓
      Source Evaluation
            ↓
      Evidence Extraction
            ↓
      Verification
            ↓
      AI Response

---

## 9.4 Tavily Backup

Use Tavily as a configured research provider/backup.

Architecture:

Research Router
       │
       ├── Primary Search
       │
       └── Tavily

Tavily should not be hardcoded as the only research source.

Provider configuration should allow:

Primary
Backup
Disabled

---

## 9.5 Search Query Generation

Do not blindly search the exact message.

Example:

User:
"Bro BTC don dey move 😂 wetin happen?"

Research query:

Bitcoin latest price market news today

The research planner converts conversational language into useful search queries.

---

## 9.6 Multiple Search Queries

For complex questions, use multiple queries.

Example:

Bitcoin current price
Bitcoin latest market news
Bitcoin major market movement today

Then combine the evidence.

---

## 9.7 Source Ranking

Sources should be ranked by:

Authority
Freshness
Relevance
Specificity
Consistency

Prefer authoritative primary sources when possible.

Examples:

- Official company websites.
- Official government sources.
- Official exchange data.
- Official sports organizations.
- Reputable news organizations.
- Established technical documentation.

---

## 9.8 Avoid Fake Information

The AI must never manufacture citations.

If no reliable source is found:

"I couldn't verify that from reliable sources."

Not:

According to Reuters...

when Reuters was never actually consulted.

---

## 9.9 Source Records

Every research result should retain:

title
url
domain
publishedAt
retrievedAt
snippet
sourceScore

The AI should receive these as evidence.

---

## 9.10 Source Freshness

For current questions:

BTC price

a result from months ago is not enough.

For historical questions:

Who won the 2018 World Cup?

older authoritative sources can be perfectly valid.

Freshness depends on the question.

---

## 9.11 Cross-Checking

For important current information:

Search result A
      +
Search result B
      ↓
Compare
      ↓
Agreement?
      │
      ├── YES → Higher confidence
      │
      └── NO → Investigate contradiction

---

## 9.12 Contradictory Results

If sources disagree:

Source A:
$79,200

Source B:
$79,450

The response should not pretend they are identical.

Possible response:

"Prices are around $79.2k–$79.5k depending on the exchange."

The AI should explain meaningful discrepancies when appropriate.

---

## 9.13 Search Confidence

Example:

Search confidence:
0.94

Factors:

Source authority
Source agreement
Freshness
Query match

If confidence is low, the AI should communicate uncertainty.

---

## 9.14 Web Search Caching

Repeated searches can waste free-tier quotas.

Cache suitable results temporarily.

Example:

"BTC price now"

If the same question arrives seconds later, reuse a sufficiently fresh result where appropriate.

Do not cache highly volatile information for too long.

---

## 9.15 Search Budget

Each group can have:

Maximum searches/hour

Example:

Crypto group:
50 searches/hour

When the limit is reached:

Research unavailable

The AI should respond honestly rather than invent information.

---

## 9.16 Search Failure

If the primary provider fails:

Primary
 ↓
FAIL
 ↓
Tavily
 ↓
SUCCESS

If both fail:

No reliable search
 ↓
Tell user verification unavailable

Do not fabricate.

---

## 9.17 Research + AI Example

User:

@AI what's BTC price now?

Pipeline:

Mention detected
      ↓
Current-data request
      ↓
Search required
      ↓
Research
      ↓
Evidence
      ↓
AI response

Possible response:

"BTC is around $79k right now, depending on the exchange."

The exact number must come from current evidence at execution time.

---

## 9.18 Research + Group Personality

Research should provide facts.

Personality controls presentation.

Example:

Evidence:
BTC ≈ $79,400

Casual personality:
"Omo BTC dey around $79.4k right now 😂"

Professional personality:
"BTC is currently around $79.4k, depending on the exchange."

The facts must not change merely to fit personality.

---

## 9.19 Research Source Transparency

For important factual responses, optionally include:

Sources:
• Coin/Exchange data
• Official announcement

The exact source-display strategy should be configurable so the group does not receive unnecessary links for every casual answer.

---

## 9.20 Chapter 9 Acceptance Criteria

☐ Research classifier works
☐ Current-information questions trigger research
☐ Static questions do not unnecessarily trigger research
☐ Search provider abstraction exists
☐ Tavily backup exists
☐ Search queries can be generated
☐ Multiple queries supported
☐ Sources are ranked
☐ Source freshness is considered
☐ Sources are deduplicated
☐ Contradictions are detected
☐ Search confidence is calculated
☐ Search results can be cached
☐ Search quotas exist
☐ Failed searches have fallback
☐ AI never invents citations
☐ AI can admit inability to verify

---

