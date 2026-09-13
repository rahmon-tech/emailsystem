# Current work

## Verified baseline

Remote `main` is currently `1a99b2274fc250eb8acc5ad9244acb0cda0f0ad1` (`feat(image): add CID-safe test-message support`). PR #31 merged from exact verified head `bbb2fafccd7a87951af5fd763b81291822ec0ae3`. Full merged-main Quality #136 passed for `1a99b2274fc250eb8acc5ad9244acb0cda0f0ad1`, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, and cleanup.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, or test-send path.

## Completed product foundation

The verified system currently includes:

- the primary Providers → Blast → Activity product shell;
- provider catalog/configuration, verification, encrypted credentials, sender-domain authorization, and stable sender identities;
- recipient CSV/TXT/XLSX import and persisted imports;
- rich/source HTML composition, HTML import, compatibility normalization, sandboxed desktop/mobile preview, plain-text generation, and immutable campaign snapshots;
- pre-flight checks, campaign preparation, durable delivery records, background dispatch, rate control, safety budgets, pause/resume/cancel controls, retry/reconciliation behavior, suppressions/unsubscribe, webhooks, tracking, Activity reporting, and exports already present in the current architecture;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- inline-vs-attachment provider message semantics and Content-ID support across SMTP, SES raw MIME, Resend, SendGrid, Postmark, Mailjet, and Mailgun, with fail-closed behavior for unsupported API transports;
- portable inline Content-ID validation capped at 127 characters and compatibility coverage for supported provider wire formats/MIME;
- the authenticated `/blast/image` Image-first composer using the existing Blast/campaign/delivery architecture;
- verified Image-first primary-image replace/remove lifecycle plus ordinary attachments sharing the authoritative five-file / 5 MB campaign attachment ceiling;
- verified Image-first test-message support through the existing `POST /test-message` API and `testProvider` owner, including sender-authorized CID-capable provider filtering, server-side fail-closed transport enforcement before safety/test-delivery reservation, PostgreSQL proof, and browser proof without live external delivery.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains a later dedicated implementation slice.

## Current milestone

The next distinct Image-first parity slice is **CC/BCC parity**.

Repository reconciliation establishes that standard Blast already accepts CC/BCC text fields, splits comma/semicolon/newline-separated addresses into arrays, and submits them through the existing campaign message snapshot. The authoritative core contract already lowercases and validates those arrays, limits each to five addresses, rejects duplicates across CC/BCC, rejects addresses already present in the recipient list, and rejects suppressed copy recipients.

Implement narrowly in this order:

1. add browser proof that Image-first exposes CC and BCC fields and includes them in the same message payload used by preview/pre-flight/send/test-message;
2. add integration proof that Image-first-shaped campaign input preserves normalized CC/BCC arrays through pre-flight and exercises the existing duplicate/list/suppression protections rather than duplicating validation in the UI;
3. add the Image-first CC/BCC fields with the same split semantics as standard Blast;
4. keep inline-image capability checks, attachment lifecycle, test-message behavior, routing, worker behavior, and persistence unchanged;
5. run the full repository Quality workflow, reconcile this document to the exact candidate, merge only from a verified head and unchanged verified parent, then verify the exact merged `main` SHA.

No schema or migration change is expected. No live recipient or external provider may be used for automated proof.

## Remaining Image-first parity after this slice

After CC/BCC parity is verified and merged, continue narrowly in this order:

1. scheduling parity;
2. tags/tracking parity using existing campaign owners rather than parallel state;
3. earlier sender/provider inline-capability visibility before pre-flight while retaining server-side fail-closed enforcement;
4. accessibility/alt-text UX and rendering/fidelity edge cases across supported transports.

## Delivery-control-plane follow-on

After the current Image-first parity increment(s), resume the dedicated control-plane gap from repository truth rather than rebuilding existing routing:

- bind approved experiment pacing/concurrency/encoding/content variables into existing dispatcher/provider-rendering owners;
- ensure production/account/domain/provider safety ceilings remain authoritative and experiments can only vary behavior inside their authorized envelope;
- record effective applied experiment values and derived pacing state in tamper-evident evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider effective-rate/pressure/recovery telemetry and restart-durability proof;
- add privacy/retention controls and final experiment Activity/UX/export polish.

Experiments must never silently route around a provider policy/enforcement decision.

## Later dependencies

After Image-first parity and the dedicated delivery-control-plane completion slices:

- reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
- remaining campaign/Activity operational gaps found by current tests and UX review, especially progress/control/export fidelity under real worker states;
- final security, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before production installation.

Do not claim VPS deployment until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
