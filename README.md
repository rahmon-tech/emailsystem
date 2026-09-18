# EmailSystem

[![Verify EmailSystem](https://github.com/rahmon-tech/emailsystem/actions/workflows/ci.yml/badge.svg)](https://github.com/rahmon-tech/emailsystem/actions/workflows/ci.yml)

EmailSystem is a self-hosted, multi-provider email campaign platform built around a simple workflow: **Sending services → Create campaign → Activity**.

It separates campaign creation from background delivery. The web application stores work quickly, while independent workers prepare recipients, coordinate provider capacity, claim deliveries, send messages, process provider events, and persist delivery state.

Provider acceptance is intentionally not treated as mailbox delivery. Ambiguous outcomes are held for reconciliation instead of being blindly resent.

## Highlights

- Multi-provider API and SMTP support for Resend, Amazon SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO, Elastic Email, and Custom SMTP.
- Verified sending domains, multiple From addresses, connection health checks, and provider-aware webhook setup.
- CSV, TXT, XLSX, and pasted-recipient imports with normalization, deduplication, and suppression handling.
- Rich-text and HTML composition, sanitization, previews, attachments, scheduling, and pre-flight checks.
- PostgreSQL-backed campaign, delivery, attempt, audit, and event state.
- Redis/BullMQ background processing with coordinated rate, concurrency, cooldown, retry, and provider-selection controls.
- Account, domain, provider, and campaign safety limits with review gates for complaints and hard bounces.
- Authenticated delivery-event handling, unsubscribe suppression, live Activity updates, pause/resume/cancel, and CSV exports.
- Docker Compose and native/systemd deployment options.
- CI covering migrations, schema drift, linting, secret checks, TypeScript, unit/integration tests, browser E2E, production builds, and container validation.

## Architecture

```text
Browser
   │
   ▼
Next.js web application
   │
   ├── PostgreSQL ── durable product and delivery state
   │
   ├── Redis/BullMQ ── queues, pacing and coordination
   │
   └── Worker processes
          │
          ├── provider API adapters
          ├── SMTP adapters
          └── webhook/event reconciliation
```

The delivery engine is designed around durable state transitions and idempotent work. A provider timeout or lost response does not automatically mean a message is safe to resend.

See [Architecture](docs/ARCHITECTURE.md) for the detailed model.

## Technology

- TypeScript
- Next.js 16 / React 19
- MUI 9
- PostgreSQL 17
- Prisma 7
- Redis 7.4
- BullMQ
- Nodemailer
- Zod
- Playwright
- Docker / Docker Compose

The repository currently targets Node.js 24.19+ and pnpm 11.19.

## Local development

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile

cp .env.example .env

# Generate these independently and place them in .env:
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # CREDENTIAL_ENCRYPTION_KEY

docker compose -f compose.dev.yaml up -d

pnpm bootstrap:native
pnpm db:migrate
pnpm user:create
pnpm dev
```

Start the worker in a second terminal:

```sh
pnpm worker
```

Set `ALLOW_MOCK_PROVIDER=true` only for development/test environments that intentionally use the mock adapter.

## Production deployment

Two deployment models are supported:

- **Docker Compose** for a dedicated installation.
- **Native/systemd** when PostgreSQL, Redis, reverse proxying, and process supervision are already managed by the host.

Read [Deployment](docs/DEPLOYMENT.md) before installing or upgrading a production instance. Native installations should also read [Native runtime](docs/NATIVE_RUNTIME.md).

Never commit production `.env` files, provider credentials, database dumps, or generated provider bootstrap files.

## Verification

Run the core checks locally with:

```sh
pnpm db:generate
pnpm lint
pnpm secrets:scan
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Integration and browser tests require the documented PostgreSQL/Redis test environment. CI performs a more complete release verification, including fresh migrations, schema-drift checks, upgrade rehearsal, browser testing, and production-container startup.

See [Verification](docs/VERIFICATION.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Provider setup and delivery webhooks](docs/PROVIDERS.md)
- [Security and operational boundaries](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Native/systemd runtime](docs/NATIVE_RUNTIME.md)
- [Verification and release checks](docs/VERIFICATION.md)

## Responsible use

EmailSystem is intended for legitimate, permission-based email operations. Operators remain responsible for consent, sender authentication, provider policies, applicable law, unsubscribe handling, and acceptable-use requirements.

The project intentionally keeps provider enforcement, suppressions, safety limits, and uncertain-delivery handling separate from ordinary retry logic.

## Project status

The application is actively maintained and has been deployed using the native/systemd runtime. Automated tests use isolated test data and mock transports where appropriate; successful CI does not claim that a third-party provider account, DNS configuration, or live production instance is healthy.

## License

A public repository is not automatically open source. No open-source license has been granted yet; standard copyright restrictions apply until a license is added.
