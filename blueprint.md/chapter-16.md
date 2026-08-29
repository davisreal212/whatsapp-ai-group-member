# Chapter 16 — AI PROVIDER ROUTING: GEMINI + GROQ + OPENROUTER

## 16.1 Purpose

The AI brain should not depend on one provider.

The planned architecture is:

                    AI BRAIN
                       │
               AI PROVIDER ROUTER
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Gemini           Groq        OpenRouter
     PRIMARY          FAST          FALLBACK

The exact provider/model choices must be configurable because free-tier limits and model availability can change.

---

## 16.2 Provider Abstraction

Create:

interface AIProvider {
  name: string;

  generateText(
    request: AIRequest
  ): Promise<AIResponse>;

  isAvailable(): Promise<boolean>;

  getUsage(): Promise<UsageStats>;
}

Implement:

GeminiProvider
GroqProvider
OpenRouterProvider

---

## 16.3 Why Provider Abstraction Matters

If the code directly calls Gemini everywhere:

Gemini API
Gemini API
Gemini API
Gemini API

switching providers becomes difficult.

Instead:

AI Brain
 ↓
Provider Router
 ↓
Provider

The brain does not care which provider actually generated the response.

---

## 16.4 Primary Provider

Default:

Gemini

The router sends normal AI requests to the primary provider.

Example:

Request
 ↓
Gemini
 ↓
Success
 ↓
Response

---

## 16.5 Fast Provider

Groq can be configured for speed-sensitive operations where its available models fit the task.

Examples:

Simple classification
Decision scoring
Short responses
Fast summarization

The router should be able to specify:

taskType

rather than sending every request to the same model.

---

## 16.6 Fallback Provider

OpenRouter can be configured as a fallback.

Example:

Gemini
  ↓
failure
  ↓
Groq
  ↓
failure
  ↓
OpenRouter

However, the router should not blindly retry the same request indefinitely.

---

## 16.7 Failure Types

Distinguish:

TIMEOUT
RATE_LIMIT
AUTH_ERROR
SERVER_ERROR
INVALID_REQUEST
MODEL_UNAVAILABLE
CONTENT_ERROR
NETWORK_ERROR

Some errors should trigger fallback.

Others should fail immediately.

---

## 16.8 Example Routing Policy

Task:
Decision classification

Preferred:
Groq

Fallback:
Gemini


Another:

Task:
Complex reasoning

Preferred:
Gemini

Fallback:
OpenRouter

Another:

Task:
Web-answer synthesis

Preferred:
Gemini

Fallback:
Groq

These settings should be configurable.

---

## 16.9 Do Not Waste Calls

A major rule:

If Decision Engine already determines IGNORE,
do not call the expensive response model.

Pipeline:

Message
 ↓
Cheap classification
 ↓
IGNORE
 ↓
STOP

instead of:

Message
 ↓
Large model
 ↓
"Ignore this"

---

## 16.10 Model Task Types

Create task categories:

DECISION
RESPONSE
SUMMARIZATION
MEMORY_EXTRACTION
MEMBER_ANALYSIS
RESEARCH_QUERY
RESEARCH_SYNTHESIS
VISION
VOICE_ANALYSIS
TASK_EXTRACTION

Each can have different provider preferences.

---

## 16.11 Provider Configuration

Dashboard:

AI PROVIDERS

Gemini
Status: Connected
Role: Primary

Groq
Status: Connected
Role: Fast

OpenRouter
Status: Connected
Role: Fallback

---

## 16.12 API Key Storage

API keys must remain server-side.

Never expose:

GEMINI_API_KEY
GROQ_API_KEY
OPENROUTER_API_KEY

to browser JavaScript.

Store them as encrypted/secrets-managed configuration.

---

## 16.13 Environment Variables

Example:

GEMINI_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...

Do not commit the actual values to Git.

Provide:

.env.example

containing only placeholders.

---

## 16.14 Provider Health

Dashboard:

AI PROVIDERS

Gemini
● Healthy

Groq
● Healthy

OpenRouter
● Healthy

If unavailable:

Gemini
● Rate limited

Groq
● Healthy

OpenRouter
● Healthy

---

## 16.15 Automatic Failover

The router should track temporary provider problems.

Example:

Gemini
Rate limited
↓
Temporarily lower priority
↓
Groq handles requests

After a cooldown:

Test Gemini
↓
Healthy
↓
Restore normal priority

---

## 16.16 Circuit Breaker

Use a circuit breaker.

States:

CLOSED
OPEN
HALF_OPEN

If Gemini repeatedly fails:

CLOSED
↓
Failures exceed threshold
↓
OPEN

The system temporarily stops sending requests to Gemini.

Later:

HALF_OPEN
↓
Test request
↓
Success
↓
CLOSED

---

## 16.17 Request Timeout

Every AI request needs a timeout.

Example:

Request
 ↓
Timeout
 ↓
Fallback

Do not let one frozen provider hold the entire WhatsApp message queue indefinitely.

---

## 16.18 Retry Policy

Use limited retries.

Example:

Temporary network error:
Retry once

Rate limit:
Wait according to provider guidance

Authentication error:
Do not repeatedly retry

---

## 16.19 AI Cost/Quota Tracking

Dashboard:

AI USAGE

Today

Gemini:
1,284 requests

Groq:
723 requests

OpenRouter:
42 requests

Also track:

success
failure
fallback
tokens if available
estimated cost if available

---

## 16.20 Free-Tier Awareness

Because the system is intended to use free tiers:

Never assume unlimited requests.

Track quotas.

Cache where useful.

Use lightweight models for simple tasks.

Avoid unnecessary responses.

Use fallback providers.

Use deterministic code where AI is unnecessary.

The dashboard should warn:

⚠ Gemini usage approaching configured limit.

---

## 16.21 Provider Routing Example

Incoming message:

@AI what is this?

Pipeline:

Decision
 ↓
Vision required
 ↓
Preferred Vision provider
 ↓
Success
 ↓
Response generation
 ↓
Gemini

Another message:

"Should I respond to this?"

Pipeline:

Decision classification
 ↓
Groq
 ↓
Fast result

Another:

Complex research synthesis

Pipeline:

Gemini
 ↓
Failure
 ↓
OpenRouter
 ↓
Success

---

## 16.22 AI Provider Logs

Do not log full sensitive conversations unnecessarily.

Instead:

Request ID:
abc123

Task:
RESPONSE

Provider:
Gemini

Status:
SUCCESS

Latency:
## 1.8 sec

Fallback:
NO

---

## 16.23 Provider Acceptance Criteria

☐ Provider interface
☐ Gemini integration
☐ Groq integration
☐ OpenRouter integration
☐ Primary provider
☐ Fast provider
☐ Fallback provider
☐ Task-specific routing
☐ Provider health checks
☐ Timeout handling
☐ Retry handling
☐ Circuit breaker
☐ Usage tracking
☐ Quota warnings
☐ Server-side API keys
☐ No secrets in frontend
☐ No unnecessary AI calls

---

