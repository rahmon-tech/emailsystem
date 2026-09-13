# Current work

## Verified baseline

Remote `main` is currently `7a8abeef3fa2a27d99e15c085bdf80f02278c220` (`feat(image): add image-first lifecycle and attachments`). PR #30 merged from exact verified head `e9c3480755222557de090a03af810485a322ac96`. Full merged-main Quality #127 passed for `7a8abeef3fa2a27d99e15c085bdf80f02278c220`, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, and cleanup.

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
- verified Image-first primary-image replace/remove lifecycle plus ordinary attachments sharing the authoritative five-file / 5 MB campaign attachment ceiling.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains a later dedicated implementation slice.

## Current milestone

Branch: `feat/image-first-test-message`

The active slice is **Image-first test-message support**. Reuse the existing `POST /test-message` API and `testProvider` owner. Do not create another test-send endpoint or bypass the existing sender, suppression, reputation, safety-budget, provider-result, or audit behavior.

Repository reconciliation for this slice established:

1. `/test-message` already accepts the normalized campaign message shape, including inline and ordinary attachment metadata;
2. standard Blast already uses this endpoint and filters its provider picker to the selected sender's authorized provider IDs;
3. Image-first currently has no test-message UI;
4. the current server path ultimately rejects unsupported inline CID transports inside the provider adapter, but only after `testProvider` has entered its safety reservation/test-delivery flow;
5. the shared `supportsInlineAttachmentTransport` capability helper is already authoritative for campaign pre-flight and is available to both core and web code.

Implement narrowly in this order:

1. add red integration proof that an inline-CID test message is rejected on an unsupported transport **before** a provider test-delivery/safety reservation is created;
2. prove the same test message is accepted through a safe mock connection configured with a CID-capable transport, without external delivery;
3. add red browser proof for Image-first test-send UI and CID-capable provider filtering;
4. add the server-side fail-closed capability guard inside the existing `testProvider` owner;
5. add the Image-first test-message dialog using the existing `/test-message` API, selected sender authorization, and the shared inline-capability matrix;
6. run the full repository Quality workflow and keep all existing campaign/pre-flight/dispatch behavior unchanged.

No schema or migration change is expected. Do not add a live delivery test; use only the existing mock provider in automated proof.

## Remaining Image-first parity after this slice

After test-message support is verified and merged, continue narrowly in this order:

1. CC/BCC parity where the standard composer already supports it;
2. scheduling parity;
3. tags/tracking parity using existing campaign owners rather than parallel state;
4. earlier sender/provider inline-capability visibility before pre-flight while retaining server-side fail-closed enforcement;
5. accessibility/alt-text UX and rendering/fidelity edge cases across supported transports.

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
