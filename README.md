# WhatsApp AI Group Member

A safety-first WhatsApp group agent based on the supplied implementation manual. It observes selected groups, filters events before AI processing, maintains lightweight communication memory, routes AI calls through replaceable providers, and executes only server-validated actions.

## What is included

- Baileys 6.7.24 linked-device adapter with persistent multi-file auth, pairing-code support, and reconnect backoff.
- Group discovery with explicit allowlisting. Newly discovered groups are disabled.
- Hard group-only policy: DMs, status events, unknown groups, disabled groups, bot messages, duplicates, and unsupported events are rejected before AI calls.
- Canonical message normalization with quote, mention, media, and sender metadata.
- Local relevance gates so casual chatter can be ignored without consuming AI quota.
- Gemini, Groq, and OpenRouter adapters behind one provider router.
- Tavily research backup with evidence bundles and an unverified fallback.
- Lightweight member communication observations with confidence and forgetting-ready timestamps.
- Structured action plans, same-group target validation, daily limits, cooldowns, dry-run mode, and idempotency.
- Neon PostgreSQL persistence in production through `DATABASE_URL`, with local durable JSON state only when no database URL is configured.
- Admin dashboard for connection, group authorization, kill switches, provider status, logs, and memory deletion.
- Tests for transport normalization, hard policy gates, action safety, and structured decisions.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Keep `DRY_RUN=true` while testing.
4. Add provider keys only when you are ready to test AI calls.
5. Run `npm install` and then `npm run dev`.
6. Open `http://localhost:3000`.

In development, the dashboard does not require an admin token and the local JSON store is used if `DATABASE_URL` is blank. In production, set a strong `ADMIN_TOKEN` and Neon `DATABASE_URL`; the server refuses to start without either. WhatsApp session credentials stay on the server under `WHATSAPP_AUTH_DIR` and are never sent to browser JavaScript.

## Pair a dedicated WhatsApp account

Use a dedicated test number. In the dashboard, enter the number in international format and select **Connect**. The pinned Baileys version supports pairing codes, and the code appears in the dashboard. Complete pairing from WhatsApp Linked Devices, then use **Sync groups** and explicitly enable only the groups the bot may enter.

Unofficial WhatsApp Web automation can result in account restrictions and may violate platform terms. Verify the current WhatsApp and Baileys behavior before deployment.

## Checks

```bash
npm run check
```

The service defaults to silence when no provider is configured, when a provider fails, when current information cannot be verified, or when a social action is ambiguous. `OUTBOUND_PAUSED=true` is the emergency outbound kill switch; `AI_PROCESSING_PAUSED=true` stops provider calls while observation and audit logging continue.

## Production checklist

- Use a dedicated WhatsApp account and persistent encrypted storage for auth state.
- Set `NODE_ENV=production`, `ADMIN_TOKEN`, provider quotas, and a real database/queue adapter.
- Keep `DRY_RUN=true` until controlled test-group scenarios pass.
- Review provider pricing and rate limits at deployment time.
- Add reverse-proxy TLS, authenticated sessions/CSRF protection, backups, log retention, and monitoring.
- Validate the real WhatsApp adapter against a controlled account separately from the AI brain.

For Docker deployment, use [`DEPLOYMENT.md`](./DEPLOYMENT.md) and `.env.production.example`. The production profile requires a Neon `DATABASE_URL`, an absolute persistent auth path, and an admin token of at least 24 characters. It starts with both dry-run and outbound pause enabled; remove those safeguards only after controlled verification.
