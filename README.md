# WhatsApp AI Group Member

A safety-first WhatsApp group agent based on the supplied implementation manual. It observes selected groups, filters events before AI processing, maintains lightweight communication memory, routes AI calls through replaceable providers, and executes only server-validated actions.

## What is included

- Baileys 6.7.24 linked-device adapter with persistent multi-file auth, pairing-code support, and reconnect backoff.
- Group discovery with explicit allowlisting. Newly discovered groups are disabled.
- Selective group policy with allowlisted DM support by default: unlisted DMs, status events, unknown groups, disabled groups, bot messages, duplicates, and unsupported events are rejected before AI calls. `DIRECT_MESSAGE_ALLOWLIST` contacts are always sent through the reply path; set `GROUP_ONLY_MODE=true` to disable all DMs.
- Canonical message normalization with quote, mention, media, and sender metadata.
- Voice-note transcription through a cached, fallback-ready speech provider, optional Gemini image description/OCR, and optional TTS audio replies with OpenAI/ElevenLabs fallback and text fallback.
- Local relevance gates so casual chatter can be ignored without consuming AI quota.
- Phoenix FastAPI (`deepseek-v4-flash` and `glm-5.3`), Gemini, Groq, and OpenRouter adapters behind one provider router with circuit health and cooldowns.
- Tavily plus no-key DuckDuckGo research providers with evidence bundles and an unverified fallback, plus DuckDuckGo/Wikimedia image search for requested pictures and memes.
- CoinGecko, optional CoinMarketCap, and Coinbase price-provider fallback for alerts.
- Lightweight member communication observations with confidence and forgetting-ready timestamps, bounded group/member retrieval, batched summaries, and maintenance for stale, archived, or duplicate memories.
- Structured action plans, same-group target validation, per-minute/hour/day limits, quiet hours, cooldowns, dry-run mode, idempotency, retry, and pending-action recovery.
- Persistent reminders and BTC/ETH price alerts with a deterministic task worker and dashboard controls.
- Normalized inbound job envelopes with bounded retries, restart recovery, media limits, and per-chat processing order.
- Protected application-state snapshots under `DATA_DIR/backups` with configurable interval and retention.
- Neon PostgreSQL persistence in production through `DATABASE_URL`, with local durable JSON state only when no database URL is configured. Optional embeddings use Gemini and Qdrant; vector writes are persisted through an outbox so restarts and provider outages can be retried safely.
- Admin dashboard for connection, group authorization, kill switches, provider status, logs, and memory deletion.
- Landing page with email/password signup and sign-in. The first account becomes the administrator; public signup closes after that.
- Tests for transport normalization, hard policy gates, action safety, and structured decisions.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Keep `DRY_RUN=true` while testing.
4. Add provider keys only when you are ready to test AI calls.
5. Run `npm install` and then `npm run dev`.
6. Open `http://localhost:3000`.

In development, the dashboard does not require an admin token and the local JSON store is used if `DATABASE_URL` is blank. In production, set a strong `ADMIN_TOKEN` and Neon `DATABASE_URL`; the server refuses to start without either. The landing page creates an administrator using a hashed password and an HttpOnly session cookie. WhatsApp session credentials stay on the server under `WHATSAPP_AUTH_DIR` and are never sent to browser JavaScript. `GET /api/health` is liveness; `GET /api/ready` returns readiness only while WhatsApp is connected.

## Pair a dedicated WhatsApp account

Use a dedicated test number. In the dashboard, enter the number in international format and select **Connect**. The pinned Baileys version supports pairing codes, and the code appears in the dashboard. Complete pairing from WhatsApp Linked Devices, then use **Sync groups** and explicitly enable only the groups the bot may enter.

Unofficial WhatsApp Web automation can result in account restrictions and may violate platform terms. Verify the current WhatsApp and Baileys behavior before deployment.

## Checks

```bash
npm run check
```

The service defaults to silence when no provider is configured, when a provider fails, when current information cannot be verified, or when a social action is ambiguous. `OUTBOUND_PAUSED=true` is the emergency outbound kill switch; `AI_PROCESSING_PAUSED=true` stops provider calls while observation and audit logging continue.

Memory limits and aging are configurable with `MEMORY_RECENT_MESSAGE_LIMIT`, `MEMORY_GROUP_LIMIT`, `MEMORY_MEMBER_LIMIT`, `MEMORY_SEMANTIC_LIMIT`, `MEMORY_STALE_AFTER_DAYS`, and `MEMORY_ARCHIVE_AFTER_DAYS`. Leave `EMBEDDING_PROVIDER=none` and `QDRANT_URL` blank to use the deterministic database-backed memory path only.

## Production checklist

- Use a dedicated WhatsApp account and persistent encrypted storage for auth state.
- Set `NODE_ENV=production`, `ADMIN_TOKEN`, provider quotas, and a real database/queue adapter.
- Keep `DRY_RUN=true` until controlled test-group scenarios pass.
- Review provider pricing and rate limits at deployment time.
- Add reverse-proxy TLS, authenticated sessions/CSRF protection, managed database backups, log retention, and monitoring.
- Validate the real WhatsApp adapter against a controlled account separately from the AI brain.

For Docker or manual Railway deployment, use [`DEPLOYMENT.md`](./DEPLOYMENT.md) and `.env.production.example`. The production profile requires a Neon `DATABASE_URL`, an absolute persistent auth path, and an admin token of at least 24 characters. It starts with both dry-run and outbound pause enabled; remove those safeguards only after controlled verification.

The deployed Koyeb landing page is at https://whatsapp-ai-suhailtechlnfo-27ca2e5b.koyeb.app. Koyeb deployment details and the scale-to-zero warning are in [`DEPLOYMENT.md`](./DEPLOYMENT.md).
