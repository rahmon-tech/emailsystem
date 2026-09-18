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

## What EmailBlast actually does

EmailBlast is more than a form that calls an email API. It owns the lifecycle around a campaign so sending can continue safely even when the browser is closed.

A typical campaign moves through these stages:

1. **Connect a sending service**  
   The user selects a built-in provider or Custom SMTP. EmailBlast supplies the known provider endpoint/host metadata, validates account-specific credentials, encrypts them before persistence, and records verification/health state.

2. **Configure the sending identity**  
   A connection is associated with a verified sending domain and one or more From addresses. Campaigns select eligible domains rather than hard-coding a single transport connection.

3. **Import recipients**  
   CSV, TXT, XLSX, or pasted addresses are parsed, normalized, deduplicated, checked against suppression state, and stored as campaign/import data rather than kept only in browser memory.

4. **Compose the message**  
   Users can use the rich editor or import HTML. EmailBlast sanitizes the content, creates the plain-text alternative, validates attachments and message structure, and stores an immutable message snapshot for the campaign.

5. **Run pre-flight checks**  
   Before sending, EmailBlast checks sender/domain eligibility, provider availability, suppression state, configured sending limits, content/message readiness, and campaign state.

6. **Queue the campaign**  
   The web request returns without keeping the browser responsible for the send. Durable campaign and delivery rows are persisted and background workers continue independently.

7. **Select an eligible route**  
   Workers evaluate the currently usable combinations of sending domain, From address, and provider connection. Disabled, blocked, cooling-down, unauthorized, or exhausted routes are excluded.

8. **Reserve capacity and start transport**  
   Redis coordinates rate, concurrency, pacing, and shared capacity while PostgreSQL remains the durable source of truth for campaign/delivery state.

9. **Send through API or SMTP**  
   Provider adapters normalize API and SMTP differences behind a common transport boundary. Each attempt records safe result data without exposing stored credentials.

10. **Reconcile the result**  
    Immediate provider acceptance is recorded, but final delivery is updated only when an authoritative event exists. Webhooks can move messages to Delivered, Bounced, Complained, and related states.

11. **Recover safely**  
    Temporary failures may become eligible for bounded retry. Unknown outcomes are not automatically resent because the provider may already have accepted the message.

12. **Observe and control**  
    Activity exposes progress and delivery state while allowing permitted pause, resume, cancel, filtering, review, and export actions.

---

## Delivery engine

The delivery engine is designed around one important rule:

> **Do not confuse “we sent a request” with “it is safe to send again.”**

Each recipient delivery has durable state in PostgreSQL. A transport attempt is recorded separately so the system can distinguish:

- work waiting in the queue;
- work claimed by a worker;
- transport that has actually started;
- provider acceptance;
- definitive rejection;
- temporary failure;
- unknown outcome;
- authenticated downstream delivery events.

This matters when a network connection dies after a provider has accepted the message but before EmailBlast receives the response. Automatically retrying that recipient could create a duplicate email.

EmailBlast therefore treats uncertain transport outcomes conservatively and waits for reconciliation or operator review where appropriate.

### Provider routing

Campaigns are not permanently tied to one provider connection.

For each delivery, the routing layer considers only routes that are currently valid for the selected sending domain and sender identity. Eligibility can be affected by:

- connection enabled/disabled state;
- successful provider verification;
- sender/domain authorization;
- provider policy state;
- configured per-second and per-minute limits;
- connection concurrency;
- daily/monthly capacity;
- cooldowns and temporary pressure;
- shared account/domain/campaign safeguards;
- suppressions;
- campaign state.

Independent healthy connections can contribute capacity without allowing one provider to bypass the safety or authorization rules of another.

### Background processing

BullMQ and Redis handle asynchronous work and coordination, while PostgreSQL stores the durable business state.

This separation means:

- campaign creation does not wait for the entire mailing job;
- closing the browser does not stop delivery;
- multiple workers can cooperate without independently multiplying rate/concurrency limits;
- a worker restart does not erase campaign/delivery truth;
- the application can reconstruct operational state from durable records when temporary Redis coordination data is lost.

---

## Safety and sending controls

EmailBlast includes sending controls at several scopes instead of relying only on the provider's external quota.

Controls can include:

- provider connection daily/monthly limits;
- account-level limits;
- sending-domain limits;
- campaign limits;
- per-second/per-minute pacing;
- concurrency limits;
- temporary provider cooldowns;
- complaint and hard-bounce review thresholds;
- sender authorization;
- account-wide suppressions.

The goal is to reduce accidental over-sending and keep a provider/account problem from automatically spreading across every campaign.

Provider policy enforcement is handled separately from normal failover. A provider that reports an enforcement/policy problem is not treated like an ordinary temporarily slow provider that should simply be routed around.

---

## Delivery status and webhook reconciliation

EmailBlast deliberately separates **Accepted** from **Delivered**.

For API/SMTP sends:

```text
Queued
  ↓
Processing
  ↓
Transport started
  ↓
Accepted / Rejected / Unknown
  ↓
Provider event
  ↓
Delivered / Bounced / Complained / other final state
```

Where supported, providers send events back to a connection-specific URL:

```text
https://your-host.example/<base-path>/api/webhooks/<connection-id>
```

EmailBlast validates the provider-specific authentication/signature, normalizes the payload, correlates it with the stored provider message/attempt information, and updates durable delivery state idempotently.

Supported verification methods include provider signatures, public verification keys, SNS verification, HTTP Basic callback credentials, and provider-specific query secrets.

A duplicate webhook does not create a duplicate delivery transition.

---

## Failure handling

The system distinguishes failures that have different operational meanings.

| Situation | EmailBlast behavior |
| --- | --- |
| Invalid provider credentials | Connection stays unavailable until corrected |
| Sender/domain not authorized | Route is excluded |
| Provider temporarily rate-limited | Connection can enter cooldown and retry later |
| Definitive recipient failure | Delivery can become failed/bounced as appropriate |
| Complaint / unsubscribe | Recipient suppression is enforced |
| Network fails before transport starts | Capacity can be released safely |
| Network fails after transport may have started | Outcome is treated conservatively as unknown |
| Provider policy/enforcement block | Sending is stopped/blocked rather than silently routed around |
| Worker restarts | Durable PostgreSQL state remains authoritative |
| Redis coordination state is lost | Safety logic fails closed/reconstructs where supported instead of assuming unlimited capacity |

Manual retry is intended for deliveries that are definitively safe to retry; accepted or uncertain outcomes are not blindly duplicated.

---

## Data and persistence model

The application keeps operational state durable rather than reconstructing campaign history from provider dashboards.

Major persisted concepts include:

- users/accounts;
- provider connections and encrypted credentials;
- sending domains and From addresses;
- recipient imports;
- suppressions;
- campaigns;
- immutable campaign message snapshots;
- deliveries;
- individual transport attempts;
- normalized provider events;
- audit/activity records;
- controlled provider-test deliveries;
- safety/review state.

PostgreSQL owns durable truth. Redis is used for queues, short-lived coordination, pacing, capacity reservation, and worker/runtime state that can be derived or safely reconstructed.

---

## Activity and observability

The Activity surface is intended to answer practical operational questions:

- Is the campaign still running?
- How many recipients are complete or remaining?
- Which sending services are currently usable?
- Is the campaign waiting because of capacity, cooldown, safety, or provider state?
- Which recipients failed, bounced, complained, or remain uncertain?
- Can the campaign be paused, resumed, cancelled, or safely retried?
- Can the results be exported?

Live updates use Server-Sent Events where appropriate so the page can update without making the browser responsible for the worker process.

Operational logs and browser/API responses are designed to avoid returning stored provider secrets.

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
  web/                  Next.js application and HTTP/UI surface
  worker/               background BullMQ worker

packages/
  core/                 campaign, delivery, safety and domain logic
  db/                   Prisma schema, generated client and migrations
  providers/            provider catalog, verification, API/SMTP adapters
  email-renderer/       HTML normalization, rendering and message snapshots

docs/                   architecture, providers, security and operations
deploy/                 Caddy and Nginx reverse-proxy examples
scripts/                bootstrap, maintenance, verification and release helpers
tests/                  unit, PostgreSQL/Redis integration and browser E2E tests
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

## Production installation

EmailBlast can be deployed in three practical ways:

| Installation | Best for | What EmailBlast manages |
| --- | --- | --- |
| **Docker Compose + built-in Caddy** | New dedicated VPS | web, worker, PostgreSQL, Redis, HTTPS proxy |
| **Docker Compose + existing proxy** | VPS already running Nginx/Caddy/other apps | web, worker, PostgreSQL, Redis; your existing proxy stays in control |
| **Native VPS / no Docker** | Hosts where you prefer system packages + systemd | Node web/worker processes; PostgreSQL/Redis/proxy are installed on the host |

For every production installation, point a domain/subdomain at the VPS first and keep ports **80/443** available to the HTTPS proxy.

### Option A — Docker Compose on a fresh VPS

This is the simplest complete installation because the repository already defines PostgreSQL 17, Redis 7.4, web, worker, persistent volumes, and Caddy.

#### 1. Install Git and Docker

Install Docker Engine with the Docker Compose plugin using Docker's official instructions for your Linux distribution. Confirm:

```sh
git --version
docker --version
docker compose version
```

#### 2. Clone EmailBlast

```sh
git clone https://github.com/rahmon-tech/emailsystem.git
cd emailsystem
```

For a release deployment, check out an exact CI-verified commit instead of relying on a moving branch:

```sh
git fetch origin main
git checkout --detach <verified-release-sha>
```

#### 3. Generate the production environment

The repository includes a production environment generator. It creates independent database, session, and credential-encryption secrets without printing them.

For a root-domain install:

```sh
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$PWD:/app" \
  -w /app \
  node:24.19.0-bookworm-slim \
  node --experimental-strip-types scripts/setup-env.ts mail.example.com
```

For a path-prefixed install such as `https://example.com/emailblast`:

```sh
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$PWD:/app" \
  -w /app \
  node:24.19.0-bookworm-slim \
  node --experimental-strip-types scripts/setup-env.ts example.com /emailblast
```

The generated `.env` is mode `0600`. Keep an encrypted backup of it because `CREDENTIAL_ENCRYPTION_KEY` is required to decrypt saved provider credentials.

#### 4. Validate and build

```sh
docker compose config --quiet
docker compose build
```

#### 5. Start PostgreSQL and Redis

```sh
docker compose up -d postgres redis
```

Wait until both are healthy:

```sh
docker compose ps
```

#### 6. Apply database migrations

```sh
docker compose run --rm web \
  node node_modules/prisma/build/index.js migrate deploy
```

#### 7. Create the first application user

```sh
docker compose run --rm -it web \
  node --import tsx scripts/create-user.ts
```

The command asks for the account email and password interactively; the password is not placed in shell history.

#### 8. Start the full stack

```sh
docker compose up -d --wait web worker proxy
```

Caddy obtains TLS automatically for the `DOMAIN` stored in `.env`.

#### 9. Verify production health

```sh
curl --fail https://mail.example.com/health/live
curl --fail https://mail.example.com/health/ready
```

For a path-prefixed install:

```sh
curl --fail https://example.com/emailblast/health/live
curl --fail https://example.com/emailblast/health/ready
```

`live` proves the web process is responding. `ready` additionally verifies PostgreSQL, Redis, and a recent worker heartbeat.

### Option B — Docker on a VPS that already has Nginx/Caddy

Use this when the server already hosts other applications and you do **not** want EmailBlast's bundled Caddy to own ports 80/443.

Generate `.env` as above, then use the shared-host Compose overlay:

```sh
docker compose -p emailblast \
  -f compose.yaml \
  -f compose.shared.yaml \
  config --quiet

docker compose -p emailblast \
  -f compose.yaml \
  -f compose.shared.yaml \
  up -d postgres redis

docker compose -p emailblast \
  -f compose.yaml \
  -f compose.shared.yaml \
  run --rm web node node_modules/prisma/build/index.js migrate deploy

docker compose -p emailblast \
  -f compose.yaml \
  -f compose.shared.yaml \
  run --rm -it web node --import tsx scripts/create-user.ts

docker compose -p emailblast \
  -f compose.yaml \
  -f compose.shared.yaml \
  up -d --wait web worker
```

By default the web container is published only on loopback at:

```text
127.0.0.1:3087
```

Point the existing reverse proxy at that loopback address. A path-prefixed Nginx example is provided in [`deploy/nginx-emailblast.conf`](deploy/nginx-emailblast.conf).

Do not expose PostgreSQL, Redis, or the application loopback port directly to the internet.

### Option C — VPS installation without Docker

This mode runs the application directly with Node.js and systemd. PostgreSQL, Redis, and the reverse proxy are ordinary host services.

A practical Ubuntu/Debian-style host needs:

- Git
- Node.js 24.19+
- pnpm 11.19
- PostgreSQL 17
- Redis 7.4
- Nginx or Caddy
- systemd

Install PostgreSQL and Redis from their supported distribution/vendor repositories, then verify:

```sh
node --version
psql --version
redis-server --version
```

#### 1. Create the application directory

```sh
sudo mkdir -p /opt/emailblast
sudo chown "$USER":"$USER" /opt/emailblast

git clone https://github.com/rahmon-tech/emailsystem.git /opt/emailblast
cd /opt/emailblast

git fetch origin main
git checkout --detach <verified-release-sha>
```

#### 2. Enable pnpm and install dependencies

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

#### 3. Create PostgreSQL database/user

Create a dedicated PostgreSQL role and database:

```sh
sudo -u postgres psql
```

Then in PostgreSQL:

```sql
CREATE ROLE emailsystem LOGIN PASSWORD 'replace-with-a-strong-random-password';
CREATE DATABASE emailsystem OWNER emailsystem;
\q
```

Do not reuse that example password. Generate a strong random value and keep it in the protected production environment file.

#### 4. Configure Redis

EmailBlast expects Redis to be persistent enough for production coordination. Enable AOF persistence and use a non-evicting policy:

```text
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```

Restart Redis after changing its configuration and verify:

```sh
redis-cli ping
```

Expected:

```text
PONG
```

#### 5. Create the production environment

```sh
cp .env.example .env
chmod 600 .env
```

Generate two independent application secrets:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Configure `.env` for host services:

```dotenv
NODE_ENV=production
APP_URL=https://mail.example.com
NEXT_PUBLIC_BASE_PATH=

DATABASE_URL=postgresql://emailsystem:YOUR_DATABASE_PASSWORD@127.0.0.1:5432/emailsystem
REDIS_URL=redis://127.0.0.1:6379

SESSION_SECRET=FIRST_RANDOM_64_HEX_VALUE
CREDENTIAL_ENCRYPTION_KEY=SECOND_RANDOM_64_HEX_VALUE

ALLOW_MOCK_PROVIDER=false
WORKER_CONCURRENCY=4
```

For `https://example.com/emailblast`, use:

```dotenv
APP_URL=https://example.com/emailblast
NEXT_PUBLIC_BASE_PATH=/emailblast
```

#### 6. Validate the native runtime

```sh
pnpm bootstrap:native
```

This validates Node/pnpm, the environment, PostgreSQL, Redis, protected file permissions, and Prisma generation. It does **not** silently apply production migrations.

#### 7. Apply migrations and create the first user

```sh
pnpm db:migrate
pnpm user:create
```

#### 8. Build the standalone production application

Root-domain install:

```sh
pnpm build:native
```

Path-prefixed install:

```sh
NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native
```

The generated web entry point is:

```text
apps/web/.next/standalone/apps/web/server.js
```

The worker entry point remains:

```text
node --import tsx apps/worker/main.ts
```

#### 9. Create systemd services

Example web service:

```ini
[Unit]
Description=EmailBlast web
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/emailblast/apps/web/.next/standalone/apps/web
EnvironmentFile=/opt/emailblast/.env
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Save it as:

```text
/etc/systemd/system/emailblast-web.service
```

Example worker:

```ini
[Unit]
Description=EmailBlast worker
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/emailblast
EnvironmentFile=/opt/emailblast/.env
ExecStart=/usr/bin/node --import tsx apps/worker/main.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Save it as:

```text
/etc/systemd/system/emailblast-worker.service
```

Service unit names such as `postgresql.service` and `redis-server.service` vary between Linux distributions. Adjust the `After=` lines to match the services installed on the host.

If Node is installed somewhere other than `/usr/bin/node`, use the actual result of:

```sh
command -v node
```

Enable and start both services:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now emailblast-web.service
sudo systemctl enable --now emailblast-worker.service
```

Check them:

```sh
systemctl --no-pager --full status emailblast-web.service
systemctl --no-pager --full status emailblast-worker.service
```

#### 10. Configure HTTPS reverse proxy

Keep the Node process on loopback and publish only HTTPS through Nginx/Caddy.

For a path-prefix deployment, adapt [`deploy/nginx-emailblast.conf`](deploy/nginx-emailblast.conf). The proxy must preserve the configured base path and allow Server-Sent Events to stream.

Do not expose PostgreSQL or Redis publicly.

#### 11. Verify the native installation

Loopback:

```sh
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
```

Public:

```sh
curl -fsS https://mail.example.com/health/live
curl -fsS https://mail.example.com/health/ready
```

For a base path, include it in both URLs.

### First login and provider setup

After installation:

1. sign in with the account created by `pnpm user:create` / `scripts/create-user.ts`;
2. open **Sending services**;
3. add a provider;
4. verify its credentials and sending domain;
5. save the generated delivery-webhook URL in the provider account when delivery events are supported;
6. use **Send test email** with a controlled recipient before running a campaign.

EmailBlast does not require provider credentials in repository files. Saved credentials are encrypted before persistence.

### Production upgrades

Always deploy a specific CI-verified SHA.

#### Docker upgrade

```sh
git fetch origin main
git checkout --detach <verified-release-sha>

docker compose build
docker compose stop worker
docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose up -d --force-recreate web worker proxy

curl --fail https://mail.example.com/health/ready
```

On an existing-proxy installation, use the same `-p emailblast -f compose.yaml -f compose.shared.yaml` arguments and do not start the bundled proxy.

#### Native/systemd upgrade

```sh
cd /opt/emailblast

git fetch origin main
git checkout --detach <verified-release-sha>

pnpm install --frozen-lockfile
pnpm bootstrap:native:check

NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native

sudo systemctl stop emailblast-worker.service
pnpm db:migrate
sudo systemctl start emailblast-worker.service
sudo systemctl restart emailblast-web.service
```

Use a blank `NEXT_PUBLIC_BASE_PATH` for a root-domain installation.

Do not use `prisma db push` for production releases.

### Backups

Back up both the database **and** the protected `.env`.

Docker PostgreSQL example:

```sh
mkdir -p backups
chmod 700 backups

docker compose exec -T postgres \
  pg_dump -U emailsystem -d emailsystem -Fc \
  > "backups/emailblast-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Native PostgreSQL example:

```sh
mkdir -p backups
chmod 700 backups

set -a
. ./.env
set +a

pg_dump "$DATABASE_URL" -Fc \
  > "backups/emailblast-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Store backups encrypted and off-host. Losing `CREDENTIAL_ENCRYPTION_KEY` makes saved provider credentials unrecoverable.

For more operational detail, read:

- [Production deployment](docs/DEPLOYMENT.md)
- [Native/systemd runtime](docs/NATIVE_RUNTIME.md)

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
