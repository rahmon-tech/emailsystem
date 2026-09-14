# Current work

## Verified baseline

Remote `main` is verified at `eb8099dc28815e00490665268cc3c52e83871c8c` (`feat(image): show inline capability before preflight (#35)`). Full merged-main Quality #159 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

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
- verified Image-first tags/tracking parity through the existing campaign tags contract, tracking settings, `trackingChoice`, snapshot rewrite, redirect, and analytics owners;
- verified Image-first inline-capability visibility that reuses the sender/provider catalog and `supportsInlineAttachmentTransport()` owner to surface eligible-versus-CID-capable transports before preview/pre-flight while preserving fail-closed server-side enforcement.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains the next dedicated implementation area after publication of the final Image-first parity slice.

## Current milestone — final Image-first alt-text fidelity

This milestone is intentionally narrow. It changes only Image-first composer alt-text provenance plus isolated browser proof. It does not alter CID HTML rendering, preview generation, provider adapters, MIME behavior, campaign/delivery contracts, schema, migrations, workers, routing, dispatcher behavior, or deployment configuration.

The candidate in this tree now preserves the distinction between generated and user-authored alt text:

- filename-derived alt text remains automatic until the user actually authors a nonblank description;
- replacing the primary image refreshes generated alt text from the replacement filename;
- manually authored nonblank alt text remains stable across later primary-image replacement;
- clearing the alt field returns it to the un-authored/generated state so a later replacement can derive a fresh filename-based description;
- existing plain-text fallback and downstream rendering behavior remain unchanged;
- automated browser proof uses only an isolated mock provider and no live recipient or external provider.

TDD/verification evidence is explicit and canonical:

- corrected test-only head `90905bf8931c0bd35d639902ebc29d97f3ef6ae8`, whose exact parent is verified merged `main` `eb8099dc28815e00490665268cc3c52e83871c8c`, added only the browser contract and seeded the existing provider prerequisite so the test reached `/blast/image` truthfully;
- Quality #163 for `90905bf8931c0bd35d639902ebc29d97f3ef6ae8` passed migrations/schema, upgrade rehearsal, lint, secrets, strict TypeScript, unit/integration tests, and production build before failing at Playwright on the unchanged stale generated-alt behavior, establishing the intended red boundary;
- implementation head `904d796ab02d519583dd79efd94abb8b189a8649` added the narrow generated-versus-authored alt provenance state and no other runtime subsystem change;
- full Quality #164 passed for `904d796ab02d519583dd79efd94abb8b189a8649`, including fresh migrations, schema/drift verification, upgrade rehearsal, lint, secrets, strict TypeScript, unit/integration tests, production build, Playwright E2E, screenshots, production-container validation, diagnostics/artifacts, cleanup, and container shutdown.

This documentation checkpoint changes no runtime behavior. Publication still requires full Quality on this exact reconciled PR head, confirmation that remote `main` remains `eb8099dc28815e00490665268cc3c52e83871c8c`, a guarded exact-head merge, and merged-main Quality on the resulting SHA.

## Image-first parity boundary

The currently planned Image-first parity sequence is complete through primary-image/attachment lifecycle, test message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, and alt-text replacement fidelity. Do not invent additional parity slices without reconciling a concrete observed gap from current tests, UX, or supported-provider behavior.

No live recipient or external provider may be used for automated parity proof.

## Delivery-control-plane follow-on

After this final Image-first parity milestone is published, resume the dedicated control-plane gap from repository truth rather than rebuilding existing routing:

- bind approved experiment pacing/concurrency/encoding/content variables into existing dispatcher/provider-rendering owners;
- ensure production/account/domain/provider safety ceilings remain authoritative and experiments can only vary behavior inside their authorized envelope;
- record effective applied experiment values and derived pacing state in tamper-evident evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider effective-rate/pressure/recovery telemetry and restart-durability proof;
- add privacy/retention controls and final experiment Activity/UX/export polish.

Experiments must never silently route around a provider policy/enforcement decision.

## Later dependencies

After the dedicated delivery-control-plane completion slices:

- reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
- remaining campaign/Activity operational gaps found by current tests and UX review, especially progress/control/export fidelity under real worker states;
- final security, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before production installation.

The existing non-Docker installation path remains valid; Image-first parity does not impose a new deployment method. Do not claim production VPS deployment complete until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
