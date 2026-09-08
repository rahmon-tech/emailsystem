# Implementation and verification report

Branch: `main`. The platform was merged in [PR #1](https://github.com/rahmon-tech/emailsystem/pull/1); the provider addendum was merged in [PR #2](https://github.com/rahmon-tech/emailsystem/pull/2) as `6fbdf14e75608374c9ad1d40ca35b63696365250`. Its verified application source is `cc99461660d77163be6cea5aa915111f975c1177`, [CI run 34279952929](https://github.com/rahmon-tech/emailsystem/actions/runs/34279952929). [Main branch CI runs](https://github.com/rahmon-tech/emailsystem/actions?query=branch%3Amain) identify subsequent exact commits for deployment.

## Architecture and implemented features

Next.js 16, React 19 and MUI 9 provide the authenticated Providers → Blast → Activity interface. TypeScript packages separate business rules, provider adapters, HTML rendering and persistence. Prisma 7 and PostgreSQL 17 own campaign snapshots, recipients, attempts, events and suppression. Independent BullMQ workers use Redis 7.4 for coordination, rate/concurrency limits and recovery.

Implemented features include encrypted connections, verification/history and controlled tests; CSV/TXT/XLSX/paste imports with deduplication; rich text and imported HTML, sanitized desktop/mobile previews, attachments and scheduling; durable preparation and dispatch; weighted routing, quotas, retries and held unknown outcomes; authenticated webhooks and signed unsubscribe; persisted Activity counts, SSE, filtering, pause/resume/cancel, recipient inspection and CSV export. Deployment includes SQL migrations, non-root web/worker containers, PostgreSQL/Redis volumes, Caddy HTTPS, health checks and backup/restore instructions.

## Provider coverage

API and SMTP adapters are implemented for Resend, Amazon SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO and Elastic Email. Custom SMTP is implemented. The development MockProvider is explicitly gated and sends no real email.

| Provider | Implemented API verification |
| --- | --- |
| Resend | Domain lookup; sending-only keys require an explicit controlled test. Save & Verify never sends. |
| SES | Official SDK GetAccount/GetEmailIdentity, sandbox and sending-policy checks, rate and remaining-quota checks. |
| Mailgun | Regional domain lookup and a separate controlled test for send permission. |
| SendGrid | Native scopes lookup requiring `mail.send`. |
| Brevo | Native account/relay checks and format-only sandbox validation, followed by a delivery-capable controlled test. |
| Postmark | Actual server-token lookup, Sandbox detection and Broadcast message-stream validation. |
| Mailjet | Native Send API SandboxMode validation with the supplied credentials. |
| SMTP2GO | Authenticated native email summary lookup and a separate controlled test where required. |
| Elastic Email | Native domain lookup and a separate controlled test where required. |

All SMTP connections use Nodemailer TLS/authentication verification and a separate test email to establish sender acceptance. SMTP authentication does not establish inbox delivery. [Provider setup and official references](PROVIDERS.md) document credentials, regions, native notifications and known deviations.

## Provider catalog addendum

The catalog now owns credential help, typed authentication, explicit SMTP port/TLS pairs, regional routing, verification strategies and test capabilities. Both Postmark SMTP modes/hosts are covered. Brevo format-only validation and explicit Resend tests have distinct behavior. A third additive migration records controlled-test mode without guessing historical values. New database integration cases verify each provider's persisted state, encryption, pool eligibility and isolated test records. Browser coverage exercises all ten provider forms and Postmark credential changes.

## Sending safety milestone

[PR #3](https://github.com/rahmon-tech/emailsystem/pull/3) adds independent rolling account/domain/provider/campaign budgets and sticky outcome brakes while preserving the completed platform and catalog. The preliminary safety source is `cbfed49d3bcc4d9ff8c38a9d6f9d4fb452acc543`, [CI run 34290077566](https://github.com/rahmon-tech/emailsystem/actions/runs/34290077566). It passes 120 unit tests, 52 real PostgreSQL/Redis integration tests and the production HTTPS browser workflow. Fresh migrations, zero drift, upgrade from exact baseline `846c288`, production build, Caddy validation and Docker web/worker readiness pass. Final candidate changes still require their own complete run before merge; CURRENT_WORK.md tracks this boundary.

Added evidence includes atomic remaining-ten races, separate processes sharing an account cap across multiple providers, all four independent caps, CC/BCC costs, conservative rolling expiry, unstarted release, UNKNOWN retention, Redis-flush reconstruction, exact 150-recipient/100-unit pacing across days, authoritative outcome deduplication, suppressed-recipient exclusion, minimum samples, explicit review and tenant ownership. Browser assertions cover settings persistence, the responsive safety dialog, and Activity account/domain usage at 390, 430, 768, 1366 and 1536 pixels. Screenshots are CI artifacts; overflow and interaction checks are automated.

The final candidate also adds concurrent reconstruction during claims and moving reserved units to the later transport-start minute. It prevents an unstarted quota refund from increasing a newer provider-reported quota and keeps unstarted reservations outside provider acceptance metrics.

## Executed provider baseline tests

The verified application source above passes the complete workflow. Subsequent documentation changes preserve the application code and run the same gates.

| Gate | Scope and result |
| --- | --- |
| Unit tests | **117 passed.** Domain transitions, HTML isolation, cryptography, every provider's API/SMTP contracts and verification, safe errors, signatures, recipient event correlation and SMTP deadlines. Exact API/SMTP hosts, auth, regions, every port/TLS pairing, Postmark modes and unsupported native-test rejection are included. Provider transports are mocked. |
| Integration tests | **36 passed.** Real PostgreSQL and Redis; MockProvider or injected transport outcomes. Concurrent claims, idempotent start, tenant isolation/CSRF, cancel during sends, early/duplicate events, retry, unknown recovery, suppression, XLSX import, shared rate/concurrency/fairness and quota reservations. New cases verify saved credentials/state for every provider, SMTP no-send verification, pool exclusion and independent test records. |
| Browser workflow | **1 passed.** Real production Next.js/HTTPS, PostgreSQL, Redis and workers with MockProvider. Login, invalid-form feedback, all ten provider forms, Postmark credential/stream modes, provider setup/verification/test, CSV deduplication, rich text/HTML import, mobile/desktop preview, pre-flight, delivered events, pause/resume/cancel, export and worker restart followed by confirmed progress. |
| Responsive UI | Providers, Blast and Activity checked at **390, 430, 768, 1366 and 1536 px**, with overflow assertions and screenshots. |
| Lint/type checking | Both pass. |
| Production build | Next.js compilation, type checking and static generation pass. |
| Fresh migrations | All three SQL migrations apply to fresh PostgreSQL; schema drift check passes. |
| Production containers | Caddy configuration validation, image build, fresh database migrations, web/worker startup and dependency-aware readiness all pass. |

Total: **154 automated tests**. Browser screenshots and failure traces are published as CI artifacts. The current workflow also validates the mounted Caddy configuration before starting production containers.

## Verification boundaries

- **Implemented:** all adapters, provider-native verification, delivery processing, notification authentication and deployment configuration described above.
- **Verified with mocks:** provider requests/responses and the full email campaign workflow. No adapter test establishes the permissions or delivery behavior of an actual provider account.
- **Verified with real infrastructure in CI:** PostgreSQL, Redis, worker restart/recovery, SQL migrations, Next.js build/runtime and Docker web/worker readiness.
- **Verified against real providers:** none. Live credentials, verified sending identities, provider quotas, webhook configuration and controlled recipient addresses are required for that proof. An actual VPS/domain is required to prove its deployment, HTTPS issuance and network configuration.

Unknown outcomes remain held for reconciliation. Imported Outlook conditional blocks are removed with a visible warning. Custom SMTP has no portable confirmed-delivery callback. These boundaries are documented in [architecture](ARCHITECTURE.md) and [security](SECURITY.md).

## Exact first-deployment commands

Deploy from `main`. Replace `mail.your-domain.com` with the domain pointing to the VPS. The private repository requires normal GitHub access on that host.

```sh
git clone --branch main https://github.com/rahmon-tech/emailsystem.git
cd emailsystem
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24.19.0-bookworm-slim node --experimental-strip-types scripts/setup-env.ts mail.your-domain.com
chmod 600 .env
docker compose build
docker compose up -d postgres redis
docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose run --rm -it web node --import tsx scripts/create-user.ts
docker compose up -d
curl --fail https://mail.your-domain.com/health/live
curl --fail https://mail.your-domain.com/health/ready
```

The account CLI prompts for the first user's email and password. Enter provider credentials afterward through Providers → Save & Verify. See [DEPLOYMENT](DEPLOYMENT.md) for updates, backup, restore and troubleshooting.
