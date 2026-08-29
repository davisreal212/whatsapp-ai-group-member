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
3. Select `Phoenix1185/whatsapp-ai-group-member` and deploy the `main` branch.
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
GROUP_ONLY_MODE=true
DIRECT_MESSAGE_ALLOWLIST=<comma-separated WhatsApp numbers or JIDs; leave empty to deny all DMs>
DRY_RUN=true
OUTBOUND_PAUSED=true
AI_PROCESSING_PAUSED=false
GROUP_COOLDOWN_MS=30000
DAILY_ACTION_LIMIT=50
ACTIONS_PER_MINUTE=10
ACTIONS_PER_HOUR=50
ACTION_MAX_ATTEMPTS=3
MESSAGE_RETENTION_DAYS=30
GEMINI_API_KEY=<optional>
GEMINI_MODEL=gemini-3.6-flash
GROQ_API_KEY=<optional>
GROQ_MODEL=openai/gpt-oss-20b
OPENROUTER_API_KEY=<optional>
OPENROUTER_MODEL=z-ai/glm-5.2:free
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

## Current Koyeb deployment

- Koyeb app: `whatsapp-ai`
- Koyeb service: `whatsapp-ai-bot`
- Live URL: https://whatsapp-ai-suhailtechlnfo-27ca2e5b.koyeb.app
- Git source: `github.com/Phoenix1185/whatsapp-ai-group-member`, branch `main`

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
- Back up the persistent volume. It contains the WhatsApp auth state and local application state.
- Monitor container logs, disk usage, connection status, provider failures, action skips, and daily action counts.
- Keep the reverse proxy on HTTPS and restrict dashboard access by network or identity provider where possible.

## Important limitations before scaling

Production uses `PostgresStore` backed by Neon and creates the required tables/indexes automatically on first start. The included `FileStore` is only a local/test fallback. For multiple replicas or high-volume groups, add a Redis-backed queue before scaling horizontally. Add managed secret storage, centralized logs, CSRF/session controls, Neon backups/branching, and a formal retention policy before exposing the dashboard broadly.
