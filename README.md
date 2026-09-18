# EmailBlast

[![Verify EmailBlast](https://github.com/rahmon-tech/emailsystem/actions/workflows/ci.yml/badge.svg)](https://github.com/rahmon-tech/emailsystem/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.4-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

**EmailBlast** is a self-hosted email campaign and delivery platform for teams that want to use one or more email providers without making the browser, a single SMTP connection, or one provider API the source of truth.

It combines campaign composition, recipient imports, provider-aware routing, background delivery, delivery-event reconciliation, sending safeguards, and operational visibility in one system.

> **Provider acceptance is not mailbox delivery.** EmailBlast records transport attempts separately from recipient delivery state and does not blindly resend uncertain outcomes.

## Highlights

- **Multi-provider delivery** — Resend, Amazon SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO, Elastic Email, and Custom SMTP.
- **Standard + Image-first campaigns** — rich text, imported HTML/source mode, attachments, scheduling, or a primary CID-embedded image with optional click-through.
- **Reusable recipient imports** — CSV, TXT, XLSX, or pasted addresses with normalization, deduplication, suppression checks, and import statistics.
- **Verified sender pools** — multiple domains and From addresses with provider/domain authorization and optional multi-connection routing.
- **Durable background sending** — PostgreSQL owns campaign/delivery state; Redis and BullMQ coordinate asynchronous work, pacing, and concurrency.
- **Conservative retry semantics** — definitive failures can be retried; uncertain post-transport outcomes are held for reconciliation.
- **Sending controls** — account/domain/provider/campaign limits, adaptive provider slowdown, cooldowns, domain soft-start, and complaint/hard-bounce protection.
- **First-party click tracking** — optional aggregate analytics with likely scanner/bot separation and no stored visitor IPs, fingerprints, cookies, or request-header history.
- **Operational Activity** — live progress, provider availability, pacing estimates, pause/resume/cancel, safe retry, suppressions, and CSV export.
- **Production deployment** — Docker Compose for dedicated/shared hosts and a native Node.js + systemd path.

See [Features](docs/FEATURES.md) for the full product and runtime behavior.

## Image-first campaigns

Image-first is a first-class campaign mode for messages built around one primary visual.

The image is stored as an **inline CID attachment**, referenced by the generated HTML, and sent through the same pre-flight, worker, provider, safety, webhook, and Activity pipeline as a standard campaign. It supports alt/plain-text fallback, an optional destination link, optional click tracking, scheduling, CC/BCC, tags, additional attachments, preview, and controlled test sends.

Current primary-image formats are PNG, JPEG, GIF, and WebP. The campaign enforces the normal attachment/file-size limits and filters provider routes that cannot send inline CID content.

Detailed behavior: [Features → Image-first campaigns](docs/FEATURES.md#image-first-campaigns).

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

Built-in providers use application-owned endpoint metadata. Provider credentials, regions, streams, SMTP options, verification behavior, and webhooks are documented in [Providers](docs/PROVIDERS.md).

## Architecture

```text
                         ┌──────────────────┐
                         │     Next.js      │
                         │  UI + HTTP API   │
                         └────────┬─────────┘
                                  │
                    durable state │
                                  ▼
                         ┌──────────────────┐
                         │   PostgreSQL     │
                         │ campaigns        │
                         │ deliveries       │
                         │ attempts/events  │
                         │ suppressions     │
                         └────────┬─────────┘
                                  │ ready work
                                  ▼
 ┌──────────────────┐    ┌──────────────────┐    ┌────────────────────┐
 │      Redis       │◄──►│  BullMQ worker   │───►│ Email providers     │
 │ pacing / leases  │    │ delivery engine │    │ API / SMTP          │
 │ queue coordination│   └────────┬─────────┘    └─────────┬──────────┘
 └──────────────────┘             │                        │
                                  │ attempts               │ webhooks/events
                                  ▼                        ▼
                         ┌──────────────────────────────────┐
                         │ PostgreSQL reconciliation state │
                         └──────────────────────────────────┘
```

PostgreSQL is the durable source of truth. Redis is used for queueing and short-lived coordination that can be reconstructed or safely re-acquired.

### Delivery semantics

A recipient delivery and a transport attempt are different records.

EmailBlast distinguishes:

```text
queued
  → processing
  → transport started
  → accepted / rejected / unknown
  → provider event
  → delivered / bounced / complained / unsubscribed
```

The distinction matters when a connection fails after transport may already have started. An **UNKNOWN** result is not automatically treated as safe to retry because the provider may already have accepted the message.

### Provider routing

Routing matters when a campaign's selected sending domain(s) have **more than one eligible provider connection**.

- one eligible connection → that connection is used;
- multiple eligible connections → EmailBlast may distribute work across connections that are currently authorized and within limits;
- no eligible connection → pre-flight or runtime capacity checks hold the work until a valid route exists.

Eligibility includes sender/domain authorization, connection health, policy state, weight, rate/concurrency limits, daily/monthly capacity, cooldowns, adaptive slowdown, and shared safety limits.

For the state model, locking boundaries, worker recovery, and reconciliation rules, read [Architecture](docs/ARCHITECTURE.md).

## Tech stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 16, React 19, MUI 9 |
| Language | TypeScript 6 |
| Database | PostgreSQL 17, Prisma 7 |
| Queue / coordination | Redis 7.4, BullMQ 6 |
| Email transport | Provider APIs, Nodemailer SMTP, AWS SES SDK |
| Editor / HTML | Tiptap, CodeMirror, sanitize-html, Juice |
| Validation | Zod |
| Tests | Node test runner, Playwright, PostgreSQL/Redis integration tests |
| Deployment | Docker Compose or Node.js + systemd |

## Quick start

### Requirements

- Node.js **22.12+**
- pnpm **11.19+**
- Docker with Compose for local PostgreSQL/Redis
- Git

### 1. Clone and install

```sh
git clone https://github.com/rahmon-tech/emailsystem.git
cd emailsystem
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

### 2. Create the local environment

```sh
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

Put the two generated values into:

```dotenv
SESSION_SECRET=<first-value>
CREDENTIAL_ENCRYPTION_KEY=<second-value>
```

For the provided development Compose file, use:

```dotenv
DATABASE_URL=postgresql://emailsystem:local-development-only@localhost:5432/emailsystem
REDIS_URL=redis://localhost:6379
APP_URL=http://localhost:3000
NEXT_PUBLIC_BASE_PATH=
```

### 3. Start PostgreSQL and Redis

```sh
docker compose -f compose.dev.yaml up -d
```

### 4. Prepare the database and first user

```sh
pnpm db:generate
pnpm db:migrate
pnpm user:create
```

### 5. Run web + worker

Terminal 1:

```sh
pnpm dev
```

Terminal 2:

```sh
pnpm worker
```

Open `http://localhost:3000`.

The mock provider is development-only and must be enabled explicitly with `ALLOW_MOCK_PROVIDER=true`.

## Production deployment

Choose the deployment model that matches the host:

| Model | Use when | Guide |
| --- | --- | --- |
| Docker Compose + bundled Caddy | Dedicated VPS; EmailBlast owns the application stack and HTTPS proxy | [Deployment](docs/DEPLOYMENT.md) |
| Docker Compose + existing proxy | VPS already runs Nginx/Caddy or other applications | [Deployment](docs/DEPLOYMENT.md) |
| Native Node.js + systemd | PostgreSQL, Redis, reverse proxy, and service supervision are host-managed | [Native runtime](docs/NATIVE_RUNTIME.md) |

Production guidance covers environment generation, migrations, first-user creation, reverse proxying, health checks, backups, upgrades, and rollback boundaries.

Deploy exact CI-verified SHAs rather than an unpinned moving branch.

## Repository layout

```text
apps/
  web/                  Next.js application and HTTP/UI surface
  worker/               BullMQ delivery worker

packages/
  core/                 campaign, delivery, routing and safety logic
  db/                   Prisma schema, generated client and migrations
  providers/            provider catalog and API/SMTP adapters
  email-renderer/       HTML normalization and message rendering

docs/                   product, architecture and operations documentation
deploy/                 reverse-proxy examples
scripts/                bootstrap, maintenance and verification helpers
tests/                  unit, integration and browser tests
```

## Verification

Common local checks:

```sh
pnpm audit:prod
pnpm db:generate
pnpm lint
pnpm secrets:scan
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

CI additionally rehearses migrations/upgrades, scans Git history for credentials, generates browser-review artifacts, builds production containers, and checks application readiness.

See [Verification](docs/VERIFICATION.md) for the full release boundary.

## Documentation

| Document | Purpose |
| --- | --- |
| [Features](docs/FEATURES.md) | Campaign modes, imports, routing, tracking, safety and Activity |
| [Architecture](docs/ARCHITECTURE.md) | Delivery model, workers, state transitions and reconciliation |
| [Providers](docs/PROVIDERS.md) | Provider configuration, API/SMTP behavior and delivery webhooks |
| [Experiments](docs/EXPERIMENTS.md) | Bounded controlled-experiment subsystem and evidence model |
| [Security](docs/SECURITY.md) | Security controls and operational boundaries |
| [Deployment](docs/DEPLOYMENT.md) | Docker production installation, backups and upgrades |
| [Native runtime](docs/NATIVE_RUNTIME.md) | Non-Docker/systemd deployment |
| [Verification](docs/VERIFICATION.md) | CI, tests and release acceptance |

## Security and responsible use

Provider credentials are encrypted before persistence. The application also applies tenant scoping, bounded uploads, HTML sanitization, mutation-origin checks, authenticated webhook processing, suppression enforcement, secret scanning, and conservative retry rules.

Do not put credentials, recipient/customer data, production dumps, or exploit details in public issues. See [SECURITY.md](SECURITY.md) for reporting guidance.

EmailBlast is intended for legitimate, permission-based email operations. Operators remain responsible for consent, sender authentication, unsubscribe obligations, provider policies, and applicable privacy/anti-spam law.

## Contributing

Reproducible bug reports, documentation improvements, provider compatibility fixes, and clearly scoped changes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

This repository is publicly visible but currently has **no open-source license**. Public visibility alone does not grant permission to copy, modify, redistribute, or commercially reuse the source.
