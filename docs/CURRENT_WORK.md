# Current work

## Verified baseline

The verified predecessor on remote `main` is `73f0a16ad148d1e752b9b69b794dbb98ecbea22f` (`feat(image): add scheduling parity (#33)`). Full merged-main Quality #149 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

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
- verified Image-first scheduling parity through the existing `scheduledAt` campaign/delivery contract, including browser-local time to ISO conversion and PostgreSQL proof that scheduled eligibility propagates unchanged to prepared deliveries.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains a later dedicated implementation slice.

## Current milestone — Image-first tags/tracking parity

This milestone reuses the standard Blast campaign tags contract plus the existing tracking settings, `trackingChoice`, snapshot-rewrite, redirect, and analytics owners. It does not add a parallel tracking backend.

The candidate in this tree:

- exposes `Tags (comma separated)` with the same comma/semicolon/newline splitting behavior used by standard Blast;
- submits those tags through the existing campaign/pre-flight payload and authoritative core validation/storage path;
- loads the account tracking configuration through the existing tracking settings API and inherits `defaultEnabled`;
- exposes the same `Track clicks` control while keeping direct sending available if tracking settings cannot be loaded;
- invalidates preview/pre-flight whenever tags or tracking selection changes;
- submits only the requested tracking choice and relies on existing server-side `trackingChoice` resolution;
- shows the resolved pre-flight tracking state without claiming links were rewritten before campaign snapshot creation;
- changes no Prisma schema, migration, worker, dispatcher, provider routing, redirect route, tracking persistence, or deployment behavior.

TDD/verification evidence is explicit:

- test-only head `5347ae6590d90a578877a0631f0756f76f5a9325` produced the intended Quality #150 browser failure before Image-first exposed tags/tracking parity;
- implementation head `c30faf205938f21c101b12f9e55b852a15dfa028` passed migrations, schema/drift, upgrade rehearsal, lint, secrets, TypeScript, unit, integration, build, and production-container validation in Quality #151; Playwright then exposed only an ambiguous `Alt text` test selector;
- selector-only head `cbc7e3de2a642564c966df277dc55f8fc7e19efe` removed that ambiguity; Quality #152 again passed every non-browser gate, and the browser artifact proved the rendered MUI control had the correct checked ARIA `switch` semantics while the test still queried the wrong `checkbox` role;
- selector-only head `d52d15659fd6e25e46f5cf4d24898fe4e1e7623f` corrected the test to target the actual switch role; full Quality #153 passed, including the tags payload, inherited tracking default/toggle, server-resolved tracking text, Playwright suite, screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

This documentation checkpoint changes no runtime behavior. Publication still requires full Quality on the exact reconciled PR head, an unchanged verified `main` parent, an exact-head guarded merge, and merged-main Quality on the resulting SHA.

## Remaining Image-first parity after tags/tracking

Continue narrowly in this order:

1. earlier sender/provider inline-capability visibility before pre-flight while retaining server-side fail-closed enforcement;
2. accessibility/alt-text UX and rendering/fidelity edge cases across supported transports.

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
