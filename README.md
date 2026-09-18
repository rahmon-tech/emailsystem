# EmailBlast

[![Verify EmailBlast](https://github.com/rahmon-tech/emailsystem/actions/workflows/ci.yml/badge.svg)](https://github.com/rahmon-tech/emailsystem/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.4-DC382D?logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)

**EmailBlast** is a self-hosted, multi-provider email campaign and delivery platform built for reliable background sending, provider-aware routing, delivery-event reconciliation, and operational control.

The product keeps the user-facing workflow simple:

**Sending services → Create campaign → Activity**

while the backend handles queues, workers, provider selection, rate limits, retries, suppressions, safety budgets, webhooks, and durable delivery state.

> Provider acceptance is not treated as mailbox delivery. Unknown outcomes are held for reconciliation instead of being blindly resent.

---

## Features

- Multi-provider **API and SMTP** sending.
- Verified sending domains and multiple From addresses.
- Provider-aware connection verification and health state.
- Delivery-event webhooks for supported providers.
- CSV, TXT, XLSX, and pasted-recipient imports.
- Recipient normalization, deduplication, and account-wide suppressions.
- Rich-text and raw HTML email composition.
- HTML sanitization, previews, attachments, scheduling, and pre-flight validation.
- Durable campaign, delivery, attempt, event, and audit records in PostgreSQL.
- Redis/BullMQ background workers for queueing and coordination.
- Provider-aware rate, concurrency, cooldown, quota, and routing controls.
- Account, domain, provider, and campaign sending safeguards.
- Complaint and hard-bounce review gates.
- Signed unsubscribe flow and suppression handling.
- Live Activity updates with pause, resume, cancel, filtering, and CSV export.
- Docker Compose and native/systemd production deployment paths.
- Full CI verification with database migrations, integration tests, browser E2E, and production-container checks.

---

## Supported sending services

| Provider | API | SMTP | Delivery events |
| --- | :---: | :---: | :---: |
| Resend | ✅ | ✅ | ✅ |
| Amazon SES | ✅ | ✅ | ✅ |
| Mailgun | ✅ | ✅ | ✅ |
| SendGrid | ✅ | ✅ | ✅ |
| Brevo | ✅ | ✅ | ✅ |
| Postmark | ✅ | ✅ | ✅ |
| Mailjet | ✅ | ✅ | ✅ |
| SMTP2GO | ✅ | ✅ | ✅ |
| Elastic Email | ✅ | ✅ | ✅ |
| Custom SMTP | — | ✅ | Provider-dependent |

Built-in services use application-owned provider metadata so users do not need to manually enter standard API endpoints or SMTP hosts.

See [Provider setup](docs/PROVIDERS.md) for credentials, verification behavior, SMTP modes, and webhook configuration.

---

## Architecture

```text
┌────────────────────┐
│      Browser       │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│   Next.js / React  │
│   Web application  │
└──────┬───────┬─────┘
       │       │
       │       └──────────────┐
       ▼                      ▼
┌──────────────┐       ┌──────────────┐
│ PostgreSQL   │       │ Redis/BullMQ │
│ durable data │       │ queue/state  │
└──────────────┘       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │   Workers    │
                       └──────┬───────┘
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
         Provider APIs       SMTP       Webhook events
```

The delivery engine uses durable state transitions and idempotent work boundaries. A timeout, dropped connection, or missing provider response does not automatically mean a message is safe to resend.

Read the full [architecture documentation](docs/ARCHITECTURE.md).

---

## Tech stack

| Area | Technology |
| --- | --- |
| Language | TypeScript |
| Web | Next.js 16, React 19 |
| UI | MUI 9 |
| Database | PostgreSQL 17 |
| ORM | Prisma 7 |
| Queue / coordination | Redis 7.4, BullMQ |
| SMTP | Nodemailer |
| Validation | Zod |
| Email editing | Tiptap, CodeMirror |
| Testing | Node test runner, Playwright |
| Deployment | Docker Compose or native/systemd |
| Package manager | pnpm 11 |
| Runtime | Node.js 24 |

---

## Repository structure

```text
apps/
  web/                  Next.js application
  worker/               background worker

packages/
  core/                 delivery and campaign business logic
  db/                   Prisma schema and database access
  providers/            provider catalog and transports
  email/                rendering and email processing
  queue/                queue and coordination helpers
  config/               shared configuration

docs/                   architecture, security and operations
deploy/                 reverse-proxy examples
scripts/                bootstrap, verification and maintenance
tests/                  unit, integration and browser tests
```

---

## Requirements

For local development:

- Node.js **24.19+**
- pnpm **11.19**
- PostgreSQL **17**
- Redis **7.4**

Docker Engine with the Compose plugin can be used to provide development infrastructure.

---

## Quick start

### 1. Clone and install

```sh
git clone https://github.com/rahmon-tech/emailsystem.git
cd emailsystem

corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

### 2. Create the environment file

```sh
cp .env.example .env
```

Generate independent secrets:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Use one value for `SESSION_SECRET` and the other for `CREDENTIAL_ENCRYPTION_KEY`.

### 3. Start PostgreSQL and Redis

```sh
docker compose -f compose.dev.yaml up -d
```

### 4. Bootstrap the application

```sh
pnpm bootstrap:native
pnpm db:migrate
pnpm user:create
```

### 5. Start the web application

```sh
pnpm dev
```

### 6. Start the worker

In a second terminal:

```sh
pnpm worker
```

The development-only mock provider can be enabled explicitly with:

```dotenv
ALLOW_MOCK_PROVIDER=true
```

It is not part of a normal production installation.

---

## Environment

The complete example is in [`.env.example`](.env.example).

Important production values include:

```dotenv
NODE_ENV=production
APP_URL=https://mail.example.com
NEXT_PUBLIC_BASE_PATH=

DATABASE_URL=postgresql://...
REDIS_URL=redis://...

SESSION_SECRET=
CREDENTIAL_ENCRYPTION_KEY=
```

Never commit:

- production `.env` files;
- provider API/SMTP credentials;
- database dumps;
- provider bootstrap files;
- production encryption/session keys.

---

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the web application in development |
| `pnpm worker` | Start the background worker |
| `pnpm build` | Production web build |
| `pnpm build:native` | Prepare native/systemd standalone runtime |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Apply repository migrations |
| `pnpm user:create` | Create an application user |
| `pnpm bootstrap:native` | Validate/configure a native environment |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run PostgreSQL/Redis integration tests |
| `pnpm test:e2e` | Run Playwright browser tests |
| `pnpm secrets:scan` | Scan current repository files for credentials |
| `pnpm secrets:scan:history` | Scan current files and Git history for credentials |
| `pnpm audit:prod` | Audit production dependencies |

---

## Testing and CI

The GitHub Actions pipeline verifies the repository against real PostgreSQL and Redis service containers.

Release checks include:

- locked dependency installation;
- production dependency audit;
- Prisma generation;
- fresh database migrations;
- schema-drift checks;
- upgrade rehearsal;
- linting;
- current-tree and Git-history secret scanning;
- TypeScript;
- unit tests;
- PostgreSQL/Redis integration tests;
- production build;
- Playwright browser E2E;
- screenshot/visual-review generation;
- production-container build and startup;
- application readiness.

Run the main local checks with:

```sh
pnpm audit:prod
pnpm db:generate
pnpm lint
pnpm secrets:scan
pnpm secrets:scan:history
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Read [Verification](docs/VERIFICATION.md) for the boundary between repository proof and live-provider/production-host acceptance.

---

## Production deployment

EmailBlast supports two production models.

### Docker Compose

Recommended for a dedicated installation where EmailBlast owns its application stack.

### Native / systemd

Useful when PostgreSQL, Redis, reverse proxying, and service supervision are already managed by an existing server.

Read:

- [Production deployment](docs/DEPLOYMENT.md)
- [Native/systemd runtime](docs/NATIVE_RUNTIME.md)

Production upgrades should deploy an **exact verified Git SHA**, back up PostgreSQL and protected keys first, apply only repository migrations, restart web and workers together, and verify both liveness and readiness.

---

## Delivery webhooks

EmailBlast generates the callback URL for each saved connection:

```text
https://your-host.example/<base-path>/api/webhooks/<connection-id>
```

The provider-specific authentication method varies:

- signed provider secret;
- public verification key;
- SNS topic verification;
- HTTP Basic callback secret;
- query-string callback secret.

Custom SMTP has no universal final-delivery protocol. Confirmed delivery is only available when the SMTP service also exposes a compatible event/webhook system.

See [Provider setup and delivery webhooks](docs/PROVIDERS.md).

---

## Security

EmailBlast includes controls for:

- salted password hashing;
- HttpOnly/SameSite sessions;
- mutation Origin checks;
- tenant-scoped database ownership;
- AES-256-GCM provider credential encryption;
- bounded uploads/imports;
- HTML sanitization;
- webhook signature/authentication verification;
- suppression enforcement;
- spreadsheet-safe CSV exports;
- production dependency auditing;
- secret scanning;
- bounded retry behavior.

Read [Security and operations](docs/SECURITY.md).

Security-sensitive reports should not include credentials, recipient data, or exploit details in public issues.

---

## Responsible use

EmailBlast is intended for legitimate, permission-based email operations.

Operators are responsible for:

- recipient consent;
- sender/domain authentication;
- unsubscribe requirements;
- provider acceptable-use policies;
- applicable privacy and anti-spam laws;
- account reputation and provider restrictions.

The delivery engine does not intentionally bypass provider enforcement, suppressions, safety limits, or uncertain-delivery safeguards.

---

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Delivery model, state transitions and system design |
| [Providers](docs/PROVIDERS.md) | Provider configuration, SMTP/API behavior and webhooks |
| [Security](docs/SECURITY.md) | Security controls and operational boundaries |
| [Deployment](docs/DEPLOYMENT.md) | Production installation, backup and upgrade guidance |
| [Native runtime](docs/NATIVE_RUNTIME.md) | Native/systemd deployment |
| [Verification](docs/VERIFICATION.md) | CI, testing and release acceptance |

---

## Project status

EmailBlast is actively maintained and has been deployed in a production-style native/systemd environment.

Automated tests use isolated test data and mock transports where appropriate. A successful CI run does not claim that an external provider account, DNS configuration, live webhook, or specific production host is healthy.

---

## Contributing

Issues and pull requests are welcome for reproducible bugs, documentation improvements, provider compatibility fixes, and clearly scoped features.

Please avoid submitting:

- real provider credentials;
- recipient/customer data;
- production database dumps;
- screenshots containing secrets;
- changes intended to bypass provider enforcement or abuse-prevention controls.

Run the relevant verification commands before opening a pull request.

---

## License

The repository is publicly visible, but no open-source license has been granted yet.

Until a license is added, normal copyright restrictions apply and public visibility alone does not grant permission to copy, modify, redistribute, or commercially reuse the source.
