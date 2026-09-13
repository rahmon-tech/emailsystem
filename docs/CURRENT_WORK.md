# Current work

## Verified baseline

Remote `main` is currently `bed23a00e45bfc5d9a52741ad791894a8a46e9a1` (`docs: record verified image-first merge`). Its parent `efd66c3198a116e6bd51f789dfd8c5ae2efc7313` is the merged Image-first feature commit that passed full Quality #120, and the documentation checkpoint itself passed full Quality #121.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, or parallel provider-routing path.

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
- the merged authenticated `/blast/image` Image-first composer using the existing Blast/campaign/delivery architecture.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by Image-first work. The current known control-plane gap is the distinction between experiment variables being **modeled** and those values being **authoritatively applied** to effective dispatcher/MIME behavior with reproducible evidence; that remains a later dedicated implementation slice.

## Current milestone

Branch: `feat/image-first-parity-lifecycle`

The next Image-first parity work is being implemented incrementally rather than as a broad composer rewrite. The first active slice is:

1. primary CID image replace/remove lifecycle;
2. ordinary file attachments alongside the primary inline image while preserving distinct `inline` versus `attachment` semantics;
3. mirror the authoritative campaign ceiling of at most five total attachments and 5 MB decoded attachment data;
4. preserve the existing provider-capability fail-closed pre-flight/dispatch behavior;
5. add browser coverage proving removing/replacing the inline image does not destroy ordinary attachments.

The red E2E contract was added first on this branch, followed by the lifecycle/attachment UI implementation. No schema or migration change is expected for this slice because both inline and ordinary attachments already live inside the immutable campaign message snapshot.

## Remaining Image-first parity after this slice

Continue in narrow dependency order after this lifecycle/attachment slice is verified and merged:

1. test-message support through the existing test-send path;
2. CC/BCC parity where the standard composer already supports it;
3. scheduling parity;
4. tags/tracking parity using existing campaign owners rather than parallel state;
5. earlier sender/provider inline-capability visibility before pre-flight while retaining server-side fail-closed enforcement;
6. accessibility/alt-text UX and rendering/fidelity edge cases across supported transports.

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
