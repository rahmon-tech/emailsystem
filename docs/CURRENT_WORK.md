# Current work

## Verified baseline

Remote `main` is verified at `efd66c3198a116e6bd51f789dfd8c5ae2efc7313` (`feat(image): add image-first CID campaign mode`). Push Quality #120 completed successfully for that exact merged SHA, including dependency install, Prisma generation, fresh PostgreSQL migrations, schema-drift verification, upgrade rehearsal, lint, secret scanning, TypeScript, unit tests, PostgreSQL/Redis integration tests, production build, Playwright browser E2E, visual-review artifacts, production-container validation, diagnostics, artifact upload, and cleanup.

PR #29 merged the final green feature head `2b21ff289b2532794b450cf5f043f039d50d182e`, which had already passed full Quality #119. The merge used the exact-head guard after remote `main` was re-read at the expected parent `16e8910040416d45ed0da49a2beda667f523a858`.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign or delivery path.

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

## Completed Image-first campaign milestone

The Image-first campaign slice is now merged and verified on `main`. It remains inside the existing Blast/campaign/delivery architecture and includes:

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

Verification chain:

- implementation head `f37d2f340fdb5ea28ca5fb75c2b11cfc4b84d1d1` — Quality #118 green;
- final reconciled PR head `2b21ff289b2532794b450cf5f043f039d50d182e` — Quality #119 green;
- merged `main` `efd66c3198a116e6bd51f789dfd8c5ae2efc7313` — Quality #120 green.

## Next dependency

The next distinct product milestone is **Image-first parity and asset lifecycle**. Begin it from verified repository truth and keep it incremental. Candidate scope, subject to reconciliation against the current implementation before coding:

1. image replace/remove lifecycle and cleanup behavior;
2. ordinary file attachments alongside the primary inline image without conflating attachment and inline semantics;
3. test-message support through the existing test-send path;
4. CC/BCC parity where the standard composer already supports it;
5. scheduling parity;
6. tags/tracking parity using existing campaign owners rather than parallel state;
7. earlier sender/provider capability visibility before pre-flight, while retaining server-side fail-closed enforcement;
8. accessibility/alt-text UX and rendering/fidelity edge cases across supported transports.

After that, continue in dependency order:

- reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
- remaining campaign/Activity operational gaps found by current tests and UX review, especially progress/control/export fidelity under real worker states;
- final security, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before production installation.

Do not claim VPS deployment until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
