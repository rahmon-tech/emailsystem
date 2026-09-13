# Current work

## Verified baseline

Remote `main` is verified at `16e8910040416d45ed0da49a2beda667f523a858` (`feat(email): preserve inline CID attachments across providers`). Push Quality #110 completed successfully for that exact SHA, including dependency install, Prisma generation, fresh PostgreSQL migrations, schema-drift verification, upgrade rehearsal, lint, secret scanning, TypeScript, unit tests, PostgreSQL/Redis integration tests, production build, browser E2E, visual-review artifacts, production-container validation, diagnostics, and cleanup.

The repository is an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign or delivery path.

## Completed product foundation

The verified system currently includes:

- the primary Providers → Blast → Activity product shell;
- provider catalog/configuration, verification, encrypted credentials, sender-domain authorization, and stable sender identities;
- recipient CSV/TXT/XLSX import and persisted imports;
- rich/source HTML composition, HTML import, compatibility normalization, sandboxed desktop/mobile preview, plain-text generation, and immutable campaign snapshots;
- pre-flight checks, campaign preparation, durable delivery records, background dispatch, rate control, safety budgets, pause/resume/cancel controls, retry/reconciliation behavior, suppressions/unsubscribe, webhooks, tracking, Activity reporting, and exports already present in the current architecture;
- provider pacing and tenant-safe operational telemetry;
- authorized experiment scopes with transport binding, stop controls, and a tamper-evident evidence ledger;
- inline-vs-attachment provider message semantics and Content-ID support across SMTP, SES raw MIME, Resend, SendGrid, Postmark, Mailjet, and Mailgun, with fail-closed behavior for unsupported API transports;
- portable inline Content-ID validation capped at 127 characters and compatibility coverage for supported provider wire formats/MIME.

The inline-CID foundation was verified both on PR #28 head `39fae831afbcd3ba3e0ec2e309165ef78ca4706c` (Quality #109) and on merged `main` `16e8910040416d45ed0da49a2beda667f523a858` (Quality #110).

## Current milestone

Branch: `feat/image-first-campaign-mode`

The next product slice is Image-first campaign composition built on the verified CID transport foundation. The first implementation must remain inside the existing Blast/campaign/delivery architecture and should:

- let the operator choose an image-first message mode without removing the existing rich/source HTML workflow;
- accept a controlled primary image upload and build email-safe HTML that references it through a CID inline attachment;
- keep ordinary file attachments distinct from inline message assets;
- validate Content-IDs and CID references before campaign creation;
- restrict pre-flight/dispatch to provider transports that explicitly support inline CID assets, instead of discovering incompatibility after delivery is claimed;
- preserve the same normalized snapshot for preview and send;
- add focused unit/integration/browser coverage before merge.

No schema change is expected for this first slice because campaign message snapshots are persisted as JSON and the provider message model already carries `disposition` and `contentId`.

## Next dependencies after Image-first

After Image-first is verified, continue in dependency order rather than redesigning completed foundations:

1. image-asset lifecycle and authoring polish: replacement/removal, accessibility/alt-text UX, provider capability visibility, and fidelity edge cases;
2. reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
3. remaining campaign/Activity operational gaps found by current tests and UX review, especially progress/control/export fidelity under real worker states;
4. final security, concurrency, performance, deployment-readiness, and VPS reconciliation before production installation.

Do not claim VPS deployment until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
