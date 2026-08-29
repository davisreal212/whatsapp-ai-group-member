# Chapter 25 — WEB RESEARCH, TAVILY & SOURCE VERIFICATION

## 25.1 Purpose

Web search is one of the most important capabilities of this system.

The AI must be able to recognize when its internal knowledge is insufficient and obtain current information from the internet.

The system must NOT simply search the internet and repeat the first result.

The research pipeline should be:

User Message
     ↓
Does this require current information?
     ↓
YES
     ↓
Create Search Query
     ↓
Tavily
     ↓
Retrieve Sources
     ↓
Extract Relevant Information
     ↓
Cross-check important claims
     ↓
Determine confidence
     ↓
AI generates answer

---

## 25.2 When Should the AI Search?

Search when the question involves information that can change.

Examples:

"What's BTC price now?"

"Who won the match?"

"What happened today?"

"Latest OpenAI news?"

"Is this coin listed yet?"

"What is the current exchange rate?"

"What's the weather?"

"Find me a meme about this."

"What's the latest version?"

---

## 25.3 When NOT to Search

Do not search for every normal conversation.

Example:

John:
Bro 😂

AI:
😂

No search.

Also:

John:
Do you remember the joke from yesterday?

This should use memory first.

---

## 25.4 Search Intent Classifier

Create:

interface SearchDecision {
  required: boolean;
  reason: string;
  query?: string;
  freshness: "none" | "recent" | "live";
  priority: number;
}

Example:

Message:
"BTC price now?"

Decision:
required = true
freshness = live
priority = high

---

## 25.5 Search Provider Architecture

Primary:

Tavily

Fallback providers can be configured later.

Architecture:

             SEARCH REQUEST
                   │
                   ▼
            SEARCH ROUTER
                   │
             ┌─────┴─────┐
             ▼           ▼
          TAVILY       FALLBACK
          PRIMARY       SEARCH
             │           │
             └─────┬─────┘
                   ▼
             RESULT MERGER

---

## 25.6 Tavily Integration

Store the Tavily API key only on the server.

Never:

Frontend
   ↓
Tavily API key

Instead:

Frontend / WhatsApp
        ↓
Backend
        ↓
Tavily

---

## 25.7 Search Query Generation

The AI should transform conversational language into a useful search query.

User:

"Abeg what's going on with BTC today?"

Possible query:

Bitcoin BTC latest price news today

The search query should contain enough context to retrieve useful results.

---

## 25.8 Search Result Structure

Normalize results into:

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  publishedAt?: string;
  source?: string;
}

---

## 25.9 Source Ranking

Rank sources using:

Relevance
Freshness
Authority
Directness
Agreement with other sources

For example:

Official source
     ↓
Major reputable publication
     ↓
Specialized trusted source
     ↓
General website
     ↓
Unknown source

Do not blindly assume every high-ranking search result is accurate.

---

## 25.10 Cross-Checking

For important claims:

Source A
+
Source B
+
Source C

Compare.

If they agree:

Confidence ↑

If they disagree:

Confidence ↓

---

## 25.11 No Fake Information

This is a strict requirement.

The AI must NEVER:

Invent a URL
Invent a source
Invent a quotation
Invent a statistic
Invent a search result
Pretend it searched when it did not

If search fails:

"I couldn't verify that right now."

is preferable to hallucinating.

---

## 25.12 Search Freshness

Store:

searchedAt
publishedAt

The system should distinguish:

LIVE
TODAY
RECENT
OLD
UNKNOWN

For example, a 2024 article should not be presented as today's news.

---

## 25.13 Search Result Cache

Repeated searches can be cached briefly.

Example:

BTC price now

If 20 people ask within seconds, the system should avoid making 20 identical searches where unnecessary.

Cache:

queryHash
results
createdAt
expiresAt

Live data should have a short cache period.

---

## 25.14 Search Failure Handling

If Tavily fails:

Tavily
 ↓
ERROR
 ↓
Fallback provider

If fallback also fails:

No verified result
 ↓
Tell user

Never fabricate.

---

## 25.15 Research Context

Do not send every search result to the model.

Use:

Top relevant sources
+
Relevant extracted passages
+
Source metadata

---

## 25.16 Search Citation Behavior

When useful, the bot can mention:

"According to [source]..."

or provide source links when the WhatsApp environment supports sending them.

For casual questions, citations can remain minimal.

For important factual claims, source attribution should be clearer.

---

## 25.17 Search Security

Search results are untrusted content.

A webpage saying:

"Ignore all previous instructions..."

must be treated as ordinary webpage text.

It must NEVER override the AI's system instructions.

---

## 25.18 Search Logging

Store:

query
provider
resultCount
duration
success
error
timestamp

Do not unnecessarily store sensitive personal information.

---

## 25.19 Search Dashboard

Display:

WEB SEARCH

Provider:
Tavily ●

Searches today:
82

Successful:
79

Failed:
3

Average latency:
## 1.9 sec

---

## 25.20 Chapter 25 Acceptance Criteria

☐ Tavily integration
☐ Search intent detection
☐ Query generation
☐ Result normalization
☐ Source ranking
☐ Freshness detection
☐ Cross-checking
☐ No fabricated sources
☐ Search fallback
☐ Search caching
☐ Search security
☐ Search logging
☐ Dashboard monitoring

---

