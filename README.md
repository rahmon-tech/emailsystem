# EmailSystem

Self-hosted, multi-provider email campaigns with a focused **Providers → Blast → Activity** workflow.

The web application stores a campaign and returns immediately. Independent workers prepare recipients, claim individual deliveries, coordinate provider limits in Redis, and record outcomes in PostgreSQL. Provider acceptance and confirmed delivery are separate states. An ambiguous send is held for reconciliation rather than resent automatically.

## Included

- API and SMTP presets for Resend, Amazon SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO and Elastic Email; public Custom SMTP.
- Encrypted credentials, provider-specific Save & Verify, separate controlled test emails and verification history.
- Idempotent eight-provider API bootstrap, verified domains, bulk sender aliases, and campaign sender selection.
- CSV, TXT, XLSX and pasted recipients, normalization, deduplication and account-wide suppressions.
- Tiptap rich text, CodeMirror HTML import, sanitized immutable email snapshots, mobile/desktop previews, attachments and scheduling.
- PostgreSQL campaign/delivery/attempt records, BullMQ workers, weighted dispatch, coordinated rate/concurrency limits, cooldowns and bounded retries.
- Independent rolling 24-hour account/domain/provider/campaign budgets, durable usage recovery, and complaint/hard-bounce pauses requiring review.
- Authenticated provider notifications, signed unsubscribe links, live SSE activity, pause/resume/cancel, filters and safe CSV exports.
- Password hashing, tenant ownership checks, CSRF protection, rate limits, Docker Compose, HTTPS proxy, migration and backup instructions.

## Sending safety

Open **Providers → Sending safety** to set rolling budgets. Defaults are 10,000 account units and 5,000 each for sender domain, provider connection and campaign. One To/CC/BCC recipient uses one unit. Adding providers never raises the shared account/domain budget. Larger campaigns queue across days; Activity shows usage and when capacity begins to return. Provider rate limits and actual quotas still apply.

Complaint/hard-bounce thresholds can pause an account or campaign after a meaningful sample. Review the provider reports, record an administrator review, then explicitly resume. See [window, recovery and brake details](docs/ARCHITECTURE.md#central-sending-safety-governor). Sending safety controls reduce accidental over-sending and help preserve provider/account health.

## Requirements

Node 24.19+, pnpm 11.19, PostgreSQL 17, Redis 7.4. Docker Engine with the Compose plugin is recommended for a dedicated VPS, but the repository also supports a native/systemd runtime. TypeScript 6 and ESLint 9 are pinned for compatibility with the current Next.js lint integration; the application uses Next.js 16, React 19, MUI 9 and Prisma 7.

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
pnpm bootstrap:native
# First use of a new empty database only:
pnpm db:migrate
pnpm user:create
pnpm dev
# In a second terminal:
pnpm worker
```

`pnpm bootstrap:native` performs read-only PostgreSQL/Redis checks and validates the runtime environment before generating Prisma. It never applies SQL migrations. If PostgreSQL and Redis are already installed natively, configure their host-reachable URLs in `.env` and skip the development Compose command.

Set `ALLOW_MOCK_PROVIDER=true` to expose the explicitly labeled development adapter. It is absent from a normal installation. It sends no real email. A fresh account contains no providers, recipients or campaigns.

## VPS installation

See [deployment instructions](docs/DEPLOYMENT.md) for Docker Compose and shared-host guidance. Existing hosts that run the web/worker processes directly under systemd should use the [native runtime guide](docs/NATIVE_RUNTIME.md). Provider bootstrap values live only in a mode-0600 git-ignored local file and are encrypted into PostgreSQL; they are never browser or repository content.

For native production builds, `pnpm build:native` packages the current `.next/static` and public assets beside the generated Next.js standalone server so the browser and server always come from the same build.

## Verification

```sh
pnpm db:generate
pnpm lint
pnpm secrets:scan
pnpm typecheck
pnpm test
# Against an isolated database whose name contains "test":
pnpm db:migrate
ALLOW_MOCK_PROVIDER=true pnpm test:integration
pnpm build
ALLOW_MOCK_PROVIDER=true pnpm test:e2e
```

GitHub Actions uses real PostgreSQL and Redis service containers, applies all SQL migrations, rehearses an upgrade from the verified provider milestone, checks schema drift, runs domain/provider/integration/browser tests, builds Next.js, validates Caddy, and starts the production web/worker containers to check readiness. Browser tests use HTTPS and the development provider; they never send real email. Screenshots and failure traces are attached to the run.

Implementation and verification status are recorded in [CURRENT_WORK](docs/CURRENT_WORK.md). Live provider delivery, account-specific permission behavior and deployment on your VPS require your credentials/infrastructure. These are not implied by a successful mock test.

## Documentation

- [Architecture and delivery semantics](docs/ARCHITECTURE.md)
- [Verification results](docs/VERIFICATION.md)
- [Provider configuration and webhook setup](docs/PROVIDERS.md)
- [Security and operational limits](docs/SECURITY.md)
- [Deployment, migration, backup and restore](docs/DEPLOYMENT.md)
- [Native / systemd runtime](docs/NATIVE_RUNTIME.md)
- [Original engineering directive](docs/MASTER_DIRECTIVE.md)
- [Provider catalog addendum](docs/PROVIDER_CATALOG_ADDENDUM.md)
