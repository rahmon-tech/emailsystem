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

## Verified Image-first parity increment

Branch: `feat/image-first-parity-lifecycle`

The first Image-first parity increment is implemented and verified on implementation head `1f1f636c379cfb1f6cba979737fb8a32fcc74c9b`. Full Quality #125 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, and cleanup.

That verified increment includes:

1. primary CID image replace/remove lifecycle;
2. ordinary file attachments alongside the primary inline image while preserving distinct `inline` versus `attachment` semantics;
3. client-side mirroring of the authoritative campaign ceiling of at most five total attachment parts and 5 MB decoded attachment data;
4. preservation of the existing provider-capability fail-closed pre-flight/dispatch behavior;
5. browser proof that removing/replacing the inline image does not destroy ordinary attachments;
6. PostgreSQL integration proof that a mixed snapshot preserves the inline image CID while ordinary attachments remain ordinary attachments;
7. a narrow Image-first pre-flight response-shape correction so the UI reads the normalized top-level plain-text field returned by the existing core API;
8. no schema, migration, provider-routing, dispatcher, safety, or alternative delivery-path change.

PR #30 remains unmerged until this final documentation reconciliation head passes the full repository Quality workflow as well. Do not treat the lifecycle slice as merged until the exact final PR head and the resulting merged `main` SHA are both verified.

## Next Image-first parity dependency

After PR #30 is merged and its exact merged `main` SHA is green, the next distinct slice is **Image-first test-message support**.

Reuse the existing `test-message` backend and normalized message/attachment snapshot rather than creating another send path. Reconcile the current provider/test-send owner before coding, then add Image-first test-send UI with sender/provider capability checks appropriate for inline CID content. The same inline/ordinary attachment semantics and fail-closed capability rules must remain authoritative.

After test-message parity, continue narrowly in this order:

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
