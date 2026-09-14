# Current work

## Verified baseline

The verified predecessor on remote `main` is `0b97d2f237f019c47cb05d4ea2f7c16a3c41e827` (`feat(image): add tags and tracking parity (#34)`). Full merged-main Quality #155 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

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
- verified Image-first CC/BCC parity through the same core campaign contract, including normalization, duplicate/list/suppression protection, copy-cost warnings, and browser payload proof;
- verified Image-first scheduling parity through the existing `scheduledAt` campaign/delivery contract, including browser-local time to ISO conversion and PostgreSQL proof that scheduled eligibility propagates unchanged to prepared deliveries;
- verified Image-first tags/tracking parity through the existing campaign tags contract, tracking settings, `trackingChoice`, snapshot rewrite, redirect, and analytics owners.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains a later dedicated implementation slice.

## Current milestone — earlier Image-first inline-capability visibility

This milestone reuses the existing sender/provider catalog plus `supportsInlineAttachmentTransport()` capability owner. It does not add or alter provider capability detection, routing, MIME rendering, test-send enforcement, schema, migrations, workers, or delivery behavior.

The candidate in this tree:

- derives the selected sender's enabled eligible providers from the existing `availableProviderIds` relationship;
- separately derives the subset that supports inline CID using the existing capability helper;
- surfaces the usable ratio immediately after sender selection and before preview/pre-flight;
- names each eligible provider in the same early composer area so mixed-capability sender configurations are visible before the user reaches test-send/pre-flight;
- keeps the existing fail-closed server-side test-send/pre-flight enforcement authoritative;
- changes no provider-routing, MIME backend, dispatcher, schema, migration, worker, or deployment behavior.

TDD/verification evidence is explicit:

- test-only head `28bd46df23a42ca69252ae92542e19f4cd183fbc` defined the browser contract for one sender with two eligible transports and intentionally failed because no early capability signal existed;
- implementation head `9950c8fee5f7e5ba382858afd0f4d6d66ad60bda` added only the narrow composer visibility behavior while reusing existing owners;
- full Quality #157 passed for `9950c8fee5f7e5ba382858afd0f4d6d66ad60bda`, including migrations, schema/drift, upgrade rehearsal, lint, secrets, strict TypeScript, unit/integration tests, production build, Playwright E2E, screenshots, production-container validation, diagnostics/artifacts, cleanup, and container shutdown.

This documentation checkpoint changes no runtime behavior. Publication still requires full Quality on the exact reconciled PR head, an unchanged verified `main` parent, an exact-head guarded merge, and merged-main Quality on the resulting SHA.

## Remaining Image-first parity after inline-capability visibility

Continue narrowly with accessibility/alt-text UX and rendering/fidelity edge cases across supported transports. Reconcile exact existing behavior first; do not rebuild the MIME/provider backend that is already verified.

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
