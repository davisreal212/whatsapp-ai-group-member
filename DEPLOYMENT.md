# Production Deployment

This service uses an unofficial WhatsApp Web/linked-device integration. Use a dedicated WhatsApp number and verify current WhatsApp and Baileys policies before deployment. Account restrictions are possible.

## Docker deployment

1. Install Docker Engine and Docker Compose on a persistent server.
2. Clone this repository.
3. Copy `.env.production.example` to `.env`.
4. Replace `ADMIN_TOKEN` with a long random value. Do not commit `.env`.
5. Set `DATABASE_URL` to the Neon connection string. Include `?sslmode=require` and use Neon's pooled connection string for long-running deployments where appropriate.
6. Add at least one AI provider key if the bot should reason about messages. Add `TAVILY_API_KEY` for current-information research.
7. Start the service with `docker compose -f docker-compose.production.yml up -d --build`.
8. Put HTTPS in front of port `3000` using a reverse proxy or managed load balancer.
9. Open the dashboard and use the phone number pairing flow. The number must contain country code and is converted to digits-only before Baileys receives it.
10. Complete WhatsApp Linked Devices pairing, select **Sync groups**, and enable groups one at a time.
11. Keep `DRY_RUN=true` and `OUTBOUND_PAUSED=true` while verifying logs and group authorization.
12. After controlled test-group verification, set both to `false` and recreate the container.

## Manual Railway deployment

Use this path when deploying from the Railway dashboard instead of the CLI.

1. Open Railway and select the `Davis Harley's Projects` workspace.
2. Create a new project or open the target project, then choose **Deploy from GitHub repo**.
3. Select `davisreal212/whatsapp-ai-group-member` and deploy the `main` branch.
4. Let Railway build from the repository `Dockerfile`. Do not replace the start command; it already runs `node dist/index.js`.
5. Add a Railway volume mounted at `/var/lib/whatsapp-ai`. The WhatsApp auth files and application data must survive restarts.
6. Add these service variables:

```text
NODE_ENV=production
PORT=3000
DATA_DIR=/var/lib/whatsapp-ai/data
WHATSAPP_AUTH_DIR=/var/lib/whatsapp-ai/whatsapp-auth
DATABASE_URL=<Neon pooled connection string with sslmode=require>
ADMIN_TOKEN=<random secret with at least 24 characters>
BOT_NAME=Kola
BOT_JID=
GROUP_ONLY_MODE=false
DIRECT_MESSAGE_ALLOWLIST=<comma-separated WhatsApp numbers or JIDs; leave empty to deny all DMs>
DRY_RUN=true
OUTBOUND_PAUSED=true
AI_PROCESSING_PAUSED=false
GROUP_COOLDOWN_MS=15000
DIRECT_REPLY_BYPASS=true
DIRECT_MENTION_BYPASS=true
DIRECT_REPLY_DELAY_MIN_MS=250
DIRECT_REPLY_DELAY_MAX_MS=1000
DIRECT_MENTION_DELAY_MIN_MS=250
DIRECT_MENTION_DELAY_MAX_MS=1000
ADAPTIVE_ACTIVITY=true
GROUP_MENTION_ALL_COOLDOWN_MS=1800000
DAILY_ACTION_LIMIT=50
ACTIONS_PER_MINUTE=10
ACTIONS_PER_HOUR=50
ACTION_MAX_ATTEMPTS=3
QUIET_HOURS_START=-1
QUIET_HOURS_END=-1
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_COUNT=7
AUDIO_REPLY_MODE=adaptive
TTS_API_KEY=<optional>
TTS_BASE_URL=https://api.openai.com/v1
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
ELEVENLABS_API_KEY=<optional speech-to-text and TTS key>
ELEVENLABS_API_BASE_URL=https://api.elevenlabs.io
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_TTS_MODEL=eleven_multilingual_v2
ELEVENLABS_AGENT_ID=<ElevenLabs agent ID>
ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID=<ElevenLabs WhatsApp phone number ID>
ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME=<approved WhatsApp call permission template>
ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE_CODE=<template language code>
CMC_API_KEY=<optional CoinMarketCap key>
MAX_MEDIA_BYTES=10485760
MAX_VIDEO_DURATION_SECONDS=300
MEDIA_DOWNLOADS_PER_HOUR=100
MESSAGE_RETENTION_DAYS=30
MEMORY_RECENT_MESSAGE_LIMIT=20
MEMORY_GROUP_LIMIT=10
MEMORY_MEMBER_LIMIT=5
MEMORY_SEMANTIC_LIMIT=5
MEMORY_STALE_AFTER_DAYS=30
MEMORY_ARCHIVE_AFTER_DAYS=90
GEMINI_API_KEY=<optional>
GEMINI_MODEL=gemini-3.6-flash
GROQ_API_KEY=<optional>
GROQ_MODEL=openai/gpt-oss-20b
OPENROUTER_API_KEY=<optional>
OPENROUTER_MODEL=z-ai/glm-5.2:free
PHOENIX_API_KEY=<FastAPI router key>
PHOENIX_API_BASE_URL=https://fastapi-ai-koyeb-app-production.up.railway.app
PHOENIX_PRIMARY_MODEL=deepseek-v4-flash
PHOENIX_SECONDARY_MODEL=glm-5.3
AI_REQUEST_TIMEOUT_MS=12000
AI_OPERATION_TIMEOUT_MS=20000
TAVILY_API_KEY=<Tavily key>
TAVILY_MAX_RESULTS=5
PROVIDER_FAILURE_THRESHOLD=3
PROVIDER_COOLDOWN_MS=60000
```

7. Generate a public domain for the service. Railway should expose port `3000`; verify `https://<your-domain>/api/health` returns a healthy response.
8. Open the domain, select **Sign up**, and create the first administrator account.
9. Enter the dedicated WhatsApp number in international format and select **Connect**. The button shows a spinner and disables itself while the connection request is running.
10. On the phone, open **WhatsApp > Linked devices > Link a device > Link with phone number**, then enter the newly displayed code. Do not reuse an older code.
11. Wait for `CONNECTED`, select **Sync groups**, and enable groups individually. Sync is a reconciliation: groups no longer visible to the current WhatsApp number are removed.
12. If `GROUP_ONLY_MODE=false`, use **Sync DMs** to show recent contacts seen by the current WhatsApp session, then add permitted phone numbers or JIDs in the dashboard's **DM allowlist** panel. An empty list denies every DM.
13. Keep `DRY_RUN=true` and `OUTBOUND_PAUSED=true` until a controlled test group is verified. Configure at least one AI provider before enabling AI processing.

## ElevenLabs voice and calling setup

The single `ELEVENLABS_API_KEY` enables incoming voice-note transcription and ElevenLabs text-to-speech. It does not enable WhatsApp calling by itself.

1. In ElevenLabs, create or select the Conversational AI agent that should answer the call and copy its agent ID into `ELEVENLABS_AGENT_ID`.
2. Add or import the WhatsApp business phone number in ElevenLabs and copy its phone number ID into `ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID`. This is the WhatsApp business number, not the user's personal recipient number.
3. In Meta/WhatsApp, create and approve the call-permission message template. Copy its exact name and language code into `ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME` and `ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE_CODE`.
4. Set `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and the four call variables in the Railway **production service** environment. Do not put them in the repository or browser.
5. Keep `DRY_RUN=true` while testing a voice note. The dashboard's Voice card should show `Ready for audio`; a failed attempt shows the provider error in the same card and in Logs.
6. Set `DRY_RUN=false` and `OUTBOUND_PAUSED=false` only after a controlled audio reply succeeds. A message containing only `call me` requests an outbound ElevenLabs WhatsApp call.

The service sends ElevenLabs audio as Opus and first requests a native WhatsApp voice note. If that format is rejected, it retries as regular audio, then falls back to text. Baileys cannot answer an incoming WhatsApp call; incoming call offers are recorded as `voice.incoming_call_unsupported` instead of being falsely reported as answered.

## Current Koyeb deployment

- Koyeb app: `whatsapp-ai`
- Koyeb service: `whatsapp-ai-bot`
- Live URL: https://whatsapp-ai-suhailtechlnfo-27ca2e5b.koyeb.app
- Git source: `github.com/davisreal212/whatsapp-ai-group-member`, branch `main`

The current Koyeb organization only permits the `free` instance type, which enforces scale-to-zero. That is suitable for checking the landing page and API, but it is not suitable for a continuously connected WhatsApp session. Upgrade the Koyeb plan and change the service to an always-on instance with minimum scale `1` before pairing the bot for unattended production use.

## Dashboard account

On the landing page, select **Sign up** and create the administrator with an email address and a password of at least eight characters. Only the first account can sign up; later visits use **Sign in**. Passwords are scrypt-hashed and sessions use an HttpOnly cookie. Keep the dashboard behind HTTPS and restrict who can reach it.

## Pairing-code path

The pinned dependency is `@whiskeysockets/baileys@6.7.24`. That version exports `requestPairingCode(phoneNumber)`. The adapter calls it only for an unregistered auth state, uses `printQRInTerminal: false`, strips `+`, spaces, parentheses, and hyphens, and stores the resulting code in the authenticated dashboard status response. Auth files stay in the persistent volume and are not sent to the browser.

## Operations

- `GET /api/health` is a public liveness check; `GET /api/ready` is a connection readiness check.
- All other `/api` routes require `Authorization: Bearer <ADMIN_TOKEN>` or `x-admin-token`.
- The dashboard has an outbound kill switch and an AI-processing pause switch.
- The dashboard's DM allowlist is persisted in the application database and can be edited without rebuilding the service.
- **Sync DMs** lists recent direct-message contacts seen by the current WhatsApp session; it does not import message content or automatically authorize anyone.
- Allowlisted DM users can set a saved reply language with `language <choice>`. English is the default and does not switch to another language unless the user changes the preference or explicitly asks for it.
- Supported saved language choices include a catalog of 100+ languages, Nigerian Pidgin, mixed mode, and automatic detection. A user can say `Always communicate in Chinese from now on` or use `language chinese` in an allowlisted DM.
- Allowlisted DM users and members of enabled groups can request an ElevenLabs WhatsApp voice call with an explicit `call me` message when all ElevenLabs WhatsApp call variables are configured. WhatsApp requires a call-permission template before the call can start; an incoming WhatsApp call cannot be answered by the Baileys adapter.
- Voice-note replies use ElevenLabs multilingual TTS first when configured, send as a native voice note when supported, retry as regular audio if voice-note mode fails, and fall back to text if audio delivery also fails.
- Users can request `translate to Chinese: ...`, `translate: ...`, `analyze: ...`, or `summarize: ...`. The translation target overrides the saved reply language for that request.
- Thread context follows explicit WhatsApp quoted replies first, then recent topic overlap and short follow-ups. A new unrelated message starts a clean topic instead of inheriting the previous thread.
- Every non-empty message in an enabled group reaches the classifier, including short messages without a quote or shared topic; the classifier may answer, ask for clarification, or choose silence based on the sender and current context instead of a hard local guess.
- `GET /api/languages` returns the supported language catalog and count. `GET /api/skills` exposes the complete blueprint skill catalog, including voice-call skills.
- The deployed image includes the `skills/` library with one documented `SKILL.md` contract per catalog entry. New entries must be added to `src/skill-catalog.ts` and regenerated with `npm run skills:sync`; model skill hints are curated from that registry and cannot grant permissions or claim actions.
- The service writes protected application-state snapshots under `DATA_DIR/backups` on startup and on the configured interval. Back up the persistent volume separately; it contains the WhatsApp auth state and local application state.
- Set `AUDIO_REPLY_MODE=adaptive` with `TTS_API_KEY` or `ELEVENLABS_API_KEY` to reply to voice notes with audio when the provider and adapter support it. ElevenLabs also provides speech-to-text fallback for incoming voice notes. Synthesis failures fall back to text.
- Set `PHOENIX_API_KEY`, `PHOENIX_API_BASE_URL`, `PHOENIX_PRIMARY_MODEL=deepseek-v4-flash`, and `PHOENIX_SECONDARY_MODEL=glm-5.3` to put the Phoenix FastAPI router ahead of the other AI providers. The two Phoenix models share the same circuit-aware fallback path.
- Memory retrieval is bounded by the `MEMORY_*_LIMIT` variables and maintenance marks old memories stale or archived using the configured day thresholds. Set `EMBEDDING_PROVIDER=gemini`, `GEMINI_API_KEY`, and `QDRANT_URL` only when semantic retrieval is ready; vector updates are queued durably and retried after restarts or provider failures.
- `EMBEDDING_DIMENSIONS` must match the configured Qdrant collection. If an existing collection uses another vector size, set a new `QDRANT_COLLECTION` name and let the service create it before reindexing; the relational memory path remains available while semantic search is unavailable.
- On startup, the vector worker creates the Qdrant keyword payload indexes used by scoped memory filters (`scopeId`, `scopeType`, `memoryType`, and `sourceMemberId`), including for an existing collection.
- Qdrant search uses the current query API with a legacy search-endpoint fallback. A failed semantic search is temporarily suppressed for five minutes to avoid repeated warnings while database-backed memory retrieval continues.
- Provider timeouts open that provider's circuit immediately for the configured cooldown, allowing the next configured provider to answer without repeatedly waiting on the same unavailable endpoint.
- AI prompts and reminder scheduling use `Africa/Lagos` and display WAT; the dashboard sidebar shows the same local time.
- Monitor container logs, disk usage, connection status, provider failures, action skips, and daily action counts.
- Keep the reverse proxy on HTTPS and restrict dashboard access by network or identity provider where possible.

## Important limitations before scaling

Production uses `PostgresStore` backed by Neon and creates the required tables/indexes automatically on first start. The included `FileStore` is only a local/test fallback. For multiple replicas or high-volume groups, add a Redis-backed queue before scaling horizontally. Add managed secret storage, centralized logs, CSRF/session controls, Neon backups/branching, and a formal retention policy before exposing the dashboard broadly.
