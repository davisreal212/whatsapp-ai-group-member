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

## Pairing-code path

The pinned dependency is `@whiskeysockets/baileys@6.7.24`. That version exports `requestPairingCode(phoneNumber)`. The adapter calls it only for an unregistered auth state, uses `printQRInTerminal: false`, strips `+`, spaces, parentheses, and hyphens, and stores the resulting code in the authenticated dashboard status response. Auth files stay in the persistent volume and are not sent to the browser.

## Operations

- `GET /api/health` is a public liveness check.
- All other `/api` routes require `Authorization: Bearer <ADMIN_TOKEN>` or `x-admin-token`.
- The dashboard has an outbound kill switch and an AI-processing pause switch.
- Back up the persistent volume. It contains the WhatsApp auth state and local application state.
- Monitor container logs, disk usage, connection status, provider failures, action skips, and daily action counts.
- Keep the reverse proxy on HTTPS and restrict dashboard access by network or identity provider where possible.

## Important limitations before scaling

Production uses `PostgresStore` backed by Neon and creates the required tables/indexes automatically on first start. The included `FileStore` is only a local/test fallback. For multiple replicas or high-volume groups, add a Redis-backed queue before scaling horizontally. Add managed secret storage, centralized logs, CSRF/session controls, Neon backups/branching, and a formal retention policy before exposing the dashboard broadly.
