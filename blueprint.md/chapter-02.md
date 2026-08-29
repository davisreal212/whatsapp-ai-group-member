# Chapter 2

TECHNOLOGY STACK, PROJECT STRUCTURE & ENGINEERING FOUNDATION

## 2.1 Purpose of This Chapter

This chapter defines the technical foundation of the AI WhatsApp Group Member.

The goal is to prevent the coding agent from randomly choosing technologies for every subsystem.

The application must be modular, maintainable and replaceable.

The architecture should allow us to change:

- AI providers.
- Web-search providers.
- Speech-to-text providers.
- Text-to-speech providers.
- WhatsApp libraries.
- Database infrastructure.
- Hosting provider.

without rewriting the entire application.

---

## 2.2 Recommended Technology Stack

Use the following stack unless there is a strong technical reason to replace a component.

Frontend

Use:

Next.js + TypeScript

Responsibilities:

- Login page.
- Dashboard.
- WhatsApp connection interface.
- Pairing-code screen.
- Group management.
- Personality settings.
- Member intelligence dashboard.
- Memory management.
- AI provider configuration.
- Web-search configuration.
- Voice/media configuration.
- Task management.
- Logs.
- System settings.

The frontend must NOT contain privileged secrets.

---

## 2.3 Backend

Use:

Node.js + TypeScript

The backend is responsible for all privileged operations.

Responsibilities include:

- WhatsApp connection.
- WhatsApp event processing.
- Group authorization.
- AI provider communication.
- Web research.
- Database operations.
- Memory processing.
- Task scheduling.
- Media processing.
- Voice processing.
- Action execution.
- Security.
- Rate limiting.
- Logging.

The frontend communicates with the backend through authenticated API endpoints.

---

## 2.4 Database

Use:

**Neon (managed PostgreSQL)**

Neon provides the managed PostgreSQL database for the application. PostgreSQL will contain durable application state.

It should store:

- Users.
- WhatsApp accounts.
- Groups.
- Group settings.
- Members.
- Messages/metadata.
- Memories.
- Relationships.
- Tasks.
- AI actions.
- Provider configuration metadata.
- Usage statistics.
- Research sources.
- Audit events.

Do not store secrets in ordinary database fields unless they are encrypted appropriately.

---

## 2.5 Redis / Queue System

Use:

Redis

Redis should handle temporary/high-speed state and queues.

Possible uses:

- Outbound message queue.
- Delayed replies.
- Task scheduling.
- Rate limiting.
- Connection state.
- Distributed locks.
- Duplicate-event prevention.
- Temporary conversation state.
- Provider cooldowns.

Do not use Redis as the permanent source of truth for important application data.

PostgreSQL remains the durable database.

---

## 2.6 WhatsApp Integration

The application will use an unofficial WhatsApp Web / linked-device integration.

Create a dedicated abstraction:

WhatsAppService
       │
       └── WhatsAppAdapter
               │
               └── WhatsApp Web library

The rest of the application must never depend directly on the library's internal objects.

For example, do NOT allow this throughout the code:

rawWhatsAppMessage.someInternalProperty

Instead:

WhatsAppAdapter
       ↓
MessageNormalizer
       ↓
MessageEvent

This makes it possible to replace the WhatsApp library later.

Because unofficial WhatsApp automation can result in account restrictions, use a dedicated WhatsApp account for development/testing and verify the current library and platform behavior before deployment.

---

## 2.7 AI Provider Architecture

The system must support multiple AI providers.

Initial configuration:

                  AI PROVIDER ROUTER
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
       Gemini           Groq        OpenRouter
       PRIMARY          FAST          FALLBACK

The application should never directly call Gemini from random files.

Instead:

DecisionService
       ↓
AIProviderRouter
       ↓
GeminiProvider
GroqProvider
OpenRouterProvider

All providers implement the same internal interface.

---

## 2.8 AI Provider Interface

Define a common interface conceptually similar to:

interface AIProvider {
  generateResponse(request: AIRequest): Promise<AIResponse>;

  classify(request: ClassificationRequest): Promise<ClassificationResult>;

  summarize(request: SummaryRequest): Promise<SummaryResult>;

  extractMemory(request: MemoryExtractionRequest): Promise<MemoryExtractionResult>;
}

Additional capabilities can be represented separately:

interface VisionProvider {}

interface EmbeddingProvider {}

interface StructuredOutputProvider {}

Do not assume every provider supports every capability.

The router must know provider capabilities.

---

## 2.9 Provider Routing

The provider router determines which provider handles each request.

Example:

SOCIAL DECISION
     ↓
Groq

because the decision may be lightweight and speed matters.

Then:

COMPLEX RESPONSE
     ↓
Gemini

And:

Gemini unavailable
     ↓
OpenRouter

The routing system should consider:

- Provider enabled/disabled.
- Current health.
- API errors.
- Rate limits.
- Quota.
- Task complexity.
- Latency.
- Configured priority.
- Required capabilities.

---

## 2.10 Provider Health Monitoring

The dashboard should show:

AI PROVIDERS

Gemini
🟢 Healthy

Groq
🟢 Healthy

OpenRouter
🟡 Limited

The system should record:

- Last successful request.
- Last failure.
- Failure count.
- Average latency.
- Current cooldown.
- Usage.
- Configured priority.

If a provider repeatedly fails, temporarily stop sending requests to it and use the fallback.

---

## 2.11 Web Research Architecture

Web research must also be provider-independent.

ResearchService
       ↓
ResearchProviderRouter
       │
       ├── Primary Search
       │
       └── Tavily Backup

The AI does not directly call Tavily.

It requests:

ResearchService.search(...)

The research service handles:

- Query generation.
- Search.
- Result filtering.
- Source ranking.
- Page extraction.
- Source freshness.
- Deduplication.
- Evidence construction.
- Provider fallback.

---

## 2.12 Truth Verification Layer

Search results must not immediately become facts.

The system needs an evidence layer.

Conceptually:

Search Results
      ↓
Source Evaluation
      ↓
Evidence Extraction
      ↓
Cross-check
      ↓
EvidenceBundle
      ↓
AI

The EvidenceBundle can contain:

interface EvidenceBundle {
  question: string;
  claims: EvidenceClaim[];
  contradictions: EvidenceContradiction[];
  retrievedAt: Date;
  overallConfidence: number;
}

The response generator should receive verified evidence rather than raw search results whenever possible.

---

## 2.13 Frontend Authentication

The dashboard must require authentication.

Initial flow:

LOGIN
  │
  ├── Email
  └── Password
        ↓
Authentication
        ↓
Authenticated Session
        ↓
Dashboard

Do not expose WhatsApp session credentials, AI API keys or other secrets to the browser.

Use secure server-side sessions/cookies or another established authentication system.

---

## 2.14 Login Page

The initial login page should be simple:

┌─────────────────────────────────────┐
│                                     │
│              🤖                     │
│       AI GROUP MEMBER               │
│                                     │
│  Email                              │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│  Password                           │
│  ┌───────────────────────────────┐  │
│  │                         👁     │  │
│  └───────────────────────────────┘  │
│                                     │
│       [ SIGN IN ]                   │
│                                     │
│       Forgot password?              │
│                                     │
└─────────────────────────────────────┘

Registration can be implemented separately if required.

---

## 2.15 Dashboard Layout

After login:

┌─────────────────────────────────────────────┐
│ AI GROUP MEMBER                  🟢 ONLINE  │
├──────────────┬──────────────────────────────┤
│ Dashboard    │                              │
│ WhatsApp     │       MAIN CONTENT           │
│ Groups       │                              │
│ Members      │                              │
│ Personality  │                              │
│ Memory       │                              │
│ AI Providers │                              │
│ Web Search   │                              │
│ Voice/Media  │                              │
│ Tasks        │                              │
│ Logs         │                              │
│ Settings     │                              │
└──────────────┴──────────────────────────────┘

The layout should work properly on both desktop and mobile.

---

## 2.16 WhatsApp Connection Page

The connection page should provide:

WHATSAPP CONNECTION

Status:
🔴 Not Connected

Phone number:
+234 ____________

[ Generate Pairing Code ]

OR

[ Connect with QR ]

────────────────────

After connection:

🟢 Connected

Phone:
+234 ••••••••78

Groups discovered:
12

Enabled:
3

The pairing code should be displayed only while valid.

Do not permanently store the pairing code.

---

## 2.17 Group Authorization

After WhatsApp connection, the application discovers groups.

The administrator sees:

GROUPS

☑ Crypto Boys
   AI: ON

☑ AI Project
   AI: ON

☐ Family
   AI: OFF

☐ Random Group
   AI: OFF

Every group should have its own settings.

Example:

GROUP SETTINGS

AI Enabled
[ ON ]

Personality
[ Default ]

Talkativeness
[ Medium ]

Web Search
[ ON ]

Voice
[ ON ]

Memes
[ ON ]

Response Cooldown
[ configurable ]

Memory
[ Enabled ]

---

## 2.18 Environment Variables

Create:

.env.example

Never commit the real ".env".

Example categories:

# Application
APP_URL=
NODE_ENV=

# Database
DATABASE_URL=

# Redis
REDIS_URL=

# Authentication
AUTH_SECRET=

# Gemini
GEMINI_API_KEY=

# Groq
GROQ_API_KEY=

# OpenRouter
OPENROUTER_API_KEY=

# Tavily
TAVILY_API_KEY=

# Speech-to-text
STT_API_KEY=

# Text-to-speech
TTS_API_KEY=

# Media storage if required
MEDIA_STORAGE_URL=
MEDIA_STORAGE_KEY=

Actual provider-specific variables may change depending on the final SDKs.

The coding agent must verify current provider requirements before implementation.

---

## 2.19 Secrets Rule

Never put API keys inside:

React components
Next.js client components
browser localStorage
URL parameters
WhatsApp messages
frontend JavaScript
public environment variables

Secrets remain server-side.

Bad:

NEXT_PUBLIC_GEMINI_API_KEY

Do not do this.

Correct:

Browser
   ↓
Backend API
   ↓
Gemini

---

## 2.20 Recommended Repository Structure

Use a monorepo structure:

ai-whatsapp-member/
│
├── apps/
│   │
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── styles/
│   │
│   └── server/
│       ├── src/
│       │   ├── api/
│       │   ├── config/
│       │   ├── workers/
│       │   └── main.ts
│       │
│       └── tests/
│
├── packages/
│   │
│   ├── whatsapp/
│   ├── ai/
│   ├── memory/
│   ├── research/
│   ├── media/
│   ├── policy/
│   ├── tasks/
│   ├── database/
│   ├── shared/
│   └── logging/
│
├── prisma/
│   └── schema/
│
├── scripts/
│
├── docs/
│
├── .env.example
├── package.json
├── README.md
└── docker-compose.yml

The exact ORM can be selected during implementation, but PostgreSQL remains the database target.

---

## 2.21 Package Responsibilities

packages/whatsapp

Responsible only for WhatsApp transport.

connect
disconnect
pair
sendMessage
sendReply
sendReaction
sendImage
sendAudio
getGroups
getGroupMembers
listenEvents

It should not contain AI logic.

---

packages/ai

Responsible for:

provider interfaces
provider router
decision generation
response generation
summarization
memory extraction

It should not directly send WhatsApp messages.

---

packages/memory

Responsible for:

group memory
member memory
relationship memory
retrieval
confidence
decay
updates
deletion

---

packages/research

Responsible for:

web search
Tavily
source ranking
source extraction
evidence
verification
caching

---

packages/media

Responsible for:

audio
images
video
stickers
STT
TTS
media validation
temporary storage

---

packages/tasks

Responsible for:

reminders
price alerts
event monitoring
scheduled tasks
conditional notifications
task cancellation
task execution

---

packages/policy

Responsible for:

group authorization
DM blocking
action validation
rate limits
cooldowns
safety rules
global pause

This package is extremely important.

The AI cannot override policy.

---

## 2.22 Canonical Domain Types

The system should use internal types rather than provider-specific objects.

Example:

interface MessageEvent {
  id: string;
  groupId: string;
  senderId: string;
  timestamp: number;

  type:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "reaction";

  text?: string;

  quotedMessageId?: string;

  mentionedMemberIds: string[];

  isReplyToBot: boolean;
  isMentioningBot: boolean;

  media?: MediaMetadata;
}

This becomes the standard format used by the AI system.

---

## 2.23 ActionPlan Type

The AI should return something similar to:

type ActionType =
  | "IGNORE"
  | "REACT"
  | "REPLY"
  | "REPLY_QUOTED"
  | "MENTION_REPLY"
  | "SEND_IMAGE"
  | "SEND_MEME"
  | "SEND_AUDIO"
  | "CREATE_TASK";

interface ActionPlan {
  action: ActionType;

  groupId: string;

  targetMessageId?: string;

  targetMemberIds?: string[];

  text?: string;

  mediaUrl?: string;

  delayMs?: number;

  confidence: number;
}

The policy layer validates this object before execution.

---

## 2.24 Task Type

Future tasks should use a structured representation.

Example:

interface AgentTask {
  id: string;

  groupId: string;

  requestingMemberId: string;

  type:
    | "REMINDER"
    | "PRICE_THRESHOLD"
    | "EVENT"
    | "NEWS"
    | "CUSTOM";

  condition: Record<string, unknown>;

  status:
    | "ACTIVE"
    | "PAUSED"
    | "COMPLETED"
    | "CANCELLED";

  createdAt: Date;

  expiresAt?: Date;
}

This allows:

"Tell me when BTC hits 80k"

to become an actual scheduled task instead of remaining as an LLM memory.

---

## 2.25 API Architecture

The frontend should communicate with endpoints conceptually like:

POST   /api/auth/login

GET    /api/dashboard

GET    /api/whatsapp/status
POST   /api/whatsapp/connect
POST   /api/whatsapp/pair
POST   /api/whatsapp/disconnect

GET    /api/groups
PATCH  /api/groups/:id

GET    /api/groups/:id/members

GET    /api/memory
DELETE /api/memory/:id

GET    /api/providers
PATCH  /api/providers/:id

GET    /api/tasks
POST   /api/tasks
PATCH  /api/tasks/:id
DELETE /api/tasks/:id

GET    /api/logs

POST   /api/system/pause
POST   /api/system/resume

The exact API framework can be selected during implementation.

---

## 2.26 WebSocket / Real-Time Updates

The dashboard should receive real-time updates for important events.

Examples:

WhatsApp connected
WhatsApp disconnected
Pairing code generated
Group discovered
Message received
AI action executed
Provider failed
Task triggered

The dashboard should not require constant manual refreshing.

Use WebSockets or Server-Sent Events depending on the implementation.

---

## 2.27 Global Emergency Stop

The system must have a global outbound kill switch.

Dashboard:

SYSTEM STATUS

🟢 AI ACTIVE

[ PAUSE ALL OUTBOUND ACTIONS ]

When activated:

AI can still:
✓ Receive events
✓ Analyze messages
✓ Update internal state
✓ Perform permitted read-only research

AI cannot:
✗ Send messages
✗ React
✗ Mention users
✗ Send media
✗ Create outbound notifications

This allows debugging without disconnecting WhatsApp.

---

## 2.28 Database Migration Rules

Never manually change production tables without migrations.

Every schema change should create a migration.

Example:

migration_001_initial
migration_002_groups
migration_003_members
migration_004_memory
migration_005_tasks

The deployment process should run migrations safely.

Backups must be configured before production use.

---

## 2.29 Logging Rules

Logs should contain enough information to diagnose problems.

Example:

EVENT_RECEIVED
groupId=...
messageId=...

DECISION
action=REPLY
confidence=0.91

PROVIDER
provider=gemini
latency=...

ACTION
status=SUCCESS

Do not unnecessarily log complete private message contents.

Sensitive information should be redacted.

---

## 2.30 Error Handling

Every subsystem must have explicit error handling.

Examples:

Gemini fails
     ↓
Provider router
     ↓
Groq/OpenRouter fallback

Web search fails:

Primary research
     ↓
Tavily

TTS fails:

TTS
 ↓
Text response fallback

WhatsApp disconnects:

Disconnected
 ↓
Reconnect with backoff
 ↓
Still failed?
 ↓
Show dashboard warning

Database fails:

Database unavailable
 ↓
Do not execute unsafe outbound actions
 ↓
Retry/recover

---

## 2.31 Duplicate Event Protection

WhatsApp events can potentially be delivered more than once.

The system must prevent duplicate responses.

Use:

WhatsApp message ID
        ↓
Check processed_events
        ↓
Already processed?
   │
   ├── YES → Ignore
   │
   └── NO → Process

Outbound actions also need idempotency keys.

---

## 2.32 Rate Limiting

The bot must have multiple levels of rate limits.

Global

Maximum outbound actions per time period.

Group

Maximum AI actions in a group.

Member

Prevent repeatedly targeting the same member.

Provider

Respect API quotas.

Research

Limit unnecessary web searches.

Media

Limit expensive audio/image generation.

Rate limits should be configurable.

---

## 2.33 Development Environment

The agent should provide a development environment that can start:

Web
Backend
PostgreSQL
Redis

with one documented command or a simple set of commands.

A local Docker Compose setup is recommended for infrastructure dependencies.

Example conceptual environment:

docker compose up -d postgres redis
npm run dev

Do not require production credentials for basic local development.

---

## 2.34 Health Checks

The backend must expose a health endpoint.

Example:

GET /api/health

Response conceptually:

{
  "status": "ok",
  "database": "ok",
  "redis": "ok",
  "whatsapp": "disconnected",
  "timestamp": "..."
}

A separate readiness check may be implemented for deployment systems.

---

## 2.35 Initial Development Milestone

At the end of this chapter, the project should be able to:

1. Start frontend.
2. Start backend.
3. Connect to PostgreSQL.
4. Connect to Redis.
5. Display login page.
6. Authenticate an administrator.
7. Display dashboard.
8. Display system health.
9. Store configuration safely.
10. Run database migrations.

WhatsApp does NOT need to be fully operational yet.

That comes in the next chapter.

---

## 2.36 Chapter 2 Acceptance Criteria

The coding agent must not proceed until all of these are satisfied:

☐ Next.js frontend running
☐ TypeScript configured
☐ Node.js backend running
☐ PostgreSQL connected
☐ Redis connected
☐ Database migration system working
☐ Authentication working
☐ Dashboard shell working
☐ Environment validation working
☐ Secrets server-side only
☐ Provider interfaces defined
☐ WhatsApp adapter interface defined
☐ Research provider interface defined
☐ Memory service interface defined
☐ Task service interface defined
☐ Policy service interface defined
☐ Health endpoint working
☐ Logging system working
☐ Error handling foundation implemented
☐ Global outbound pause state implemented
☐ Repository structure established

The agent should then stop and verify the foundation before beginning the WhatsApp integration.

---

## 2.37 Next Chapter

# Chapter 3 — WHATSAPP CONNECTION, PAIRING & SESSION MANAGEMENT

Chapter 3 will implement the actual WhatsApp connection.

It will cover:

- Connecting the WhatsApp account from the website.
- Phone-number input.
- Pairing-code generation.
- QR fallback.
- Linked-device behavior.
- Session persistence.
- Authentication state.
- Connection status.
- Reconnection.
- Logout.
- Multiple connection states.
- Secure session storage.
- WhatsApp event listener.
- Group discovery.
- Detecting groups versus DMs.
- First hard group-only security filter.
- Handling WhatsApp connection errors.
- Dashboard real-time connection updates.

This is where the website will finally be able to connect to the WhatsApp account.