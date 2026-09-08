# EmailSystem

Self-hosted, multi-provider email campaigns with a focused **Providers → Blast → Activity** workflow.

The web application stores a campaign and returns immediately. Independent workers prepare recipients, claim individual deliveries, coordinate provider limits in Redis, and record outcomes in PostgreSQL. Provider acceptance and confirmed delivery are separate states. An ambiguous send is held for reconciliation rather than resent automatically.

## Included

- API and SMTP presets for Resend, Amazon SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO and Elastic Email; public Custom SMTP.
- Encrypted credentials, provider-specific Save & Verify, separate controlled test emails and verification history.
- CSV, TXT, XLSX and pasted recipients, normalization, deduplication and account-wide suppressions.
- Tiptap rich text, CodeMirror HTML import, sanitized immutable email snapshots, mobile/desktop previews, attachments and scheduling.
- PostgreSQL campaign/delivery/attempt records, BullMQ workers, weighted dispatch, coordinated rate/concurrency limits, cooldowns and bounded retries.
- Authenticated provider notifications, signed unsubscribe links, live SSE activity, pause/resume/cancel, filters and safe CSV exports.
- Password hashing, tenant ownership checks, CSRF protection, rate limits, Docker Compose, HTTPS proxy, migration and backup instructions.

## Requirements

Node 24.19+, pnpm 11.19, PostgreSQL 17, Redis 7.4. Docker Engine with the Compose plugin is recommended for a VPS. TypeScript 6 and ESLint 9 are pinned for compatibility with the current Next.js lint integration; the application uses Next.js 16, React 19, MUI 9 and Prisma 7.

## Local development

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
# Edit DATABASE_URL to use local-development-only as the password.
# Generate SESSION_SECRET and CREDENTIAL_ENCRYPTION_KEY independently:
openssl rand -hex 32
openssl rand -hex 32
docker compose -f compose.dev.yaml up -d
pnpm db:generate
pnpm db:migrate
pnpm user:create
pnpm dev
# In a second terminal:
pnpm worker
```

Set `ALLOW_MOCK_PROVIDER=true` to expose the explicitly labeled development adapter. It is absent from a normal installation. It sends no real email. A fresh account contains no providers, recipients or campaigns.

## VPS installation

See [deployment instructions](docs/DEPLOYMENT.md), including first-user creation, upgrades, health checks and backups. Provider keys belong in encrypted connections entered through the UI, not in environment variables.

## Verification

```sh
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
# Against an isolated database whose name contains "test":
pnpm db:migrate
ALLOW_MOCK_PROVIDER=true pnpm test:integration
pnpm build
ALLOW_MOCK_PROVIDER=true pnpm test:e2e
```

GitHub Actions uses real PostgreSQL and Redis service containers, applies the initial migration, checks schema drift, runs domain/provider/integration/browser tests, builds Next.js and checks the production image. Browser tests use HTTPS and the development provider; they never send real email. Screenshots and traces are attached to the run.

Implementation and verification status are recorded in [CURRENT_WORK](docs/CURRENT_WORK.md). Live provider delivery, account-specific permission behavior and deployment on your VPS require your credentials/infrastructure. These are not implied by a successful mock test.

## Documentation

- [Architecture and delivery semantics](docs/ARCHITECTURE.md)
- [Provider configuration and webhook setup](docs/PROVIDERS.md)
- [Security and operational limits](docs/SECURITY.md)
- [Deployment, migration, backup and restore](docs/DEPLOYMENT.md)
- [Original engineering directive](docs/MASTER_DIRECTIVE.md)
