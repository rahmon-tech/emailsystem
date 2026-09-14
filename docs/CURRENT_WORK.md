# Current work

## Verified baseline

The verified predecessor on remote `main` is `c1664948121495f4b81d8215c3e9623166bd21b7` (`feat(image): add CC BCC parity (#32)`). Full merged-main Quality #144 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, or test-send path.

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
- verified Image-first test-message support through the existing `POST /test-message` API and `testProvider` owner, including sender-authorized CID-capable provider filtering and server-side fail-closed transport enforcement;
- verified Image-first CC/BCC parity through the same core campaign contract, including normalization, duplicate/list/suppression protection, copy-cost warnings, and browser payload proof.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains a later dedicated implementation slice.

## Current milestone — Image-first scheduling parity

Scheduling parity reuses the existing standard Blast and campaign/delivery owners rather than adding another scheduler.

The implementation in this tree:

- exposes `Schedule (your local time)` in Image-first with the same `datetime-local` contract as standard Blast;
- converts the browser-local value to an ISO timestamp before pre-flight/create-campaign submission;
- changes the primary action and confirmation language from send to schedule when a time is present;
- leaves immediate-send behavior unchanged when the scheduling field is empty;
- relies on the existing core `scheduledAt` validation and campaign persistence;
- relies on existing campaign preparation to copy `Campaign.scheduledAt` to each delivery `nextAttemptAt`;
- changes no Prisma schema, migration, worker, dispatcher, routing, provider, or deployment behavior.

TDD evidence is explicit: test-only head `996fb9439866c113d43a77d21925c0549e5c2df8` produced the intended Playwright failure because Image-first did not yet expose the scheduling field. The implemented code/integration head `7eb7191c76d383819c2beca342d2b5b9db5536e3` then passed full Quality #147, including the browser local-time→ISO proof and PostgreSQL proof that the requested time persists on the campaign and propagates unchanged to prepared deliveries.

This documentation checkpoint does not change runtime behavior. Publication still requires full Quality on the exact final PR head, an unchanged verified `main` parent, an exact-head guarded merge, and merged-main Quality on the resulting SHA.

## Remaining Image-first parity after scheduling

Continue narrowly in this order:

1. tags/tracking parity using the existing campaign tags and tracking settings/owners rather than parallel state;
2. earlier sender/provider inline-capability visibility before pre-flight while retaining server-side fail-closed enforcement;
3. accessibility/alt-text UX and rendering/fidelity edge cases across supported transports.

No live recipient or external provider may be used for automated parity proof.

## Delivery-control-plane follow-on

After the Image-first parity increments, resume the dedicated control-plane gap from repository truth rather than rebuilding existing routing:

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

The existing non-Docker installation path remains valid; Image-first parity does not impose a new deployment method. Do not claim production VPS deployment complete until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
