# Current work

## Verified baseline

Remote `main` is still `16e8910040416d45ed0da49a2beda667f523a858` (`feat(email): preserve inline CID attachments across providers`). Push Quality #110 completed successfully for that exact SHA, including dependency install, Prisma generation, fresh PostgreSQL migrations, schema-drift verification, upgrade rehearsal, lint, secret scanning, TypeScript, unit tests, PostgreSQL/Redis integration tests, production build, browser E2E, visual-review artifacts, production-container validation, diagnostics, and cleanup.

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

## Image-first campaign milestone

Branch: `feat/image-first-campaign-mode`

The Image-first implementation is complete on the feature branch and remains inside the existing Blast/campaign/delivery architecture. It now includes:

- an authenticated `/blast/image` composer path without removing or redesigning the existing rich/source Blast workflow;
- a controlled primary image upload that generates responsive email-safe HTML referencing the image through a CID inline attachment;
- alt text used for the image accessibility text and plain-text fallback;
- campaign-level inline attachment validation, including missing/duplicate/unsafe Content-ID rejection and the portable 127-character Content-ID boundary;
- validation that HTML CID references and inline attachments match in both directions;
- provider-capability filtering during pre-flight so unsupported API transports fail closed before campaign creation;
- the same inline-CID capability guard re-applied during dispatch before provider transmission;
- reuse of existing recipient imports, sender identities, normalized snapshots, preview, pre-flight, campaigns, worker, and Activity flow;
- focused unit/contract, PostgreSQL integration, and Playwright browser coverage;
- responsive mobile visual-review coverage for the Image-first composer;
- no schema or migration change.

Implementation head `f37d2f340fdb5ea28ca5fb75c2b11cfc4b84d1d1` passed full Quality #118, including migrations/schema checks, lint, secret scanning, TypeScript, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review artifacts, production-container validation, diagnostics, and cleanup.

This documentation reconciliation is the final feature-branch checkpoint. Do not mark PR #29 ready or merge until the exact resulting branch SHA also passes the complete repository Quality workflow. Before merge, re-read remote `main` and require its exact SHA to remain the expected parent. Merge using an exact-head guard, then require a fresh full Quality run on the exact merged `main` SHA before calling the milestone complete.

## Next dependencies after Image-first

After PR #29 is merged and the exact merged `main` SHA is fully green, continue in dependency order rather than redesigning completed foundations:

1. Image-first parity and asset lifecycle: image replace/remove flows, ordinary attachments alongside the inline image, test-message support, CC/BCC, scheduling, tags/tracking parity, earlier provider-capability visibility, accessibility/alt-text polish, and rendering/fidelity edge cases;
2. reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
3. remaining campaign/Activity operational gaps found by current tests and UX review, especially progress/control/export fidelity under real worker states;
4. final security, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before production installation.

Do not claim VPS deployment until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
