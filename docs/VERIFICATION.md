# Verification and release checks

EmailSystem separates repository verification from live-provider and production-host verification.

A green CI run proves that the selected source tree passed the automated repository checks. It does not prove that a third-party provider account, DNS record, TLS certificate, production database, or live webhook is currently healthy.

## Continuous integration

The GitHub Actions workflow verifies:

- locked dependency installation;
- high/critical production dependency audit;
- Prisma client generation;
- migrations against a fresh PostgreSQL database;
- migration/schema drift;
- upgrade rehearsal;
- source linting;
- current-tree and Git-history secret scanning;
- strict TypeScript checks;
- unit tests;
- PostgreSQL/Redis integration tests;
- production Next.js build;
- Playwright browser E2E;
- screenshot/visual-review generation;
- production container build/startup;
- readiness checks and diagnostics.

The workflow uses isolated PostgreSQL/Redis services and development/mock provider behavior where appropriate. It never claims live inbox delivery.

## Local verification

Install locked dependencies first:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

Run static and unit checks:

```sh
pnpm audit:prod
pnpm db:generate
pnpm lint
pnpm secrets:scan
pnpm secrets:scan:history
pnpm typecheck
pnpm test
```

Integration tests require an isolated database whose name clearly identifies it as a test database, plus Redis:

```sh
pnpm db:migrate
ALLOW_MOCK_PROVIDER=true pnpm test:integration
```

Build and browser verification:

```sh
pnpm build
ALLOW_MOCK_PROVIDER=true pnpm test:e2e
```

## Delivery-state verification

Repository tests verify the distinction between:

- queued work;
- transport start;
- provider acceptance/rejection;
- unknown transport outcome;
- authenticated delivery/bounce/complaint events;
- final durable delivery state.

Generic SMTP acceptance is not treated as proof of mailbox delivery. Confirmed delivery requires an authoritative provider event or another explicitly supported downstream signal.

## Release acceptance

Before publishing or deploying a release:

1. select the exact commit SHA;
2. require a green CI run for that SHA;
3. review migrations and environment changes;
4. back up the production database and protected keys;
5. deploy the exact verified SHA;
6. restart web and worker processes together;
7. verify local and public liveness/readiness;
8. verify provider/webhook configuration with controlled test recipients when live acceptance is required.

## What CI does not prove

Automated repository verification cannot prove:

- provider account permissions or quota;
- sender/domain DNS verification;
- provider production-access approval;
- external webhook reachability from a specific provider account;
- reverse-proxy/TLS correctness on an unseen host;
- inbox placement;
- compliance with an operator's recipient-consent obligations.

Those remain environment-specific operational checks.
