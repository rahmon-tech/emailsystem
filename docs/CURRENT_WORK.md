# Current work

## Verified baseline

Remote `main` is verified at `48155985b5e82591faef05e1822948b7aace7b37` (`feat(experiment): bind run-wide concurrency cap (#37)`). Full merged-main Quality #175 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

## Completed product foundation

The verified system currently includes:

- the primary Providers → Blast → Activity product shell;
- provider catalog/configuration, verification, encrypted credentials, sender-domain authorization, stable sender identities, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- verified experiment run-wide concurrency binding: the approved experiment cap is enforced immediately before transport start across workers/providers, saturation defers without pausing or consuming an experiment attempt, and `transport.started` evidence records the applied cap and occupancy while stricter production ceilings remain authoritative;
- inline-vs-attachment provider message semantics and Content-ID support across SMTP, SES raw MIME, Resend, SendGrid, Postmark, Mailjet, and Mailgun, with fail-closed behavior for unsupported API transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image replace/remove, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the verified optional primary-image destination link from PR #38;
- Image-first destination URLs accept only complete HTTP(S) destinations, preserve unlinked markup when empty, use the existing campaign link/tracking pipeline when enabled, and reject unsafe schemes such as `javascript:` without adding another tracking or redirect owner.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Verified concurrency milestone

PR #37 (`feat/experiment-concurrency-binding`) is published on verified `main`.

Canonical evidence:

- test-only commit `1c095af7b1657b8806fd9d0c62b1506bb9f853a8` established the intended behavior red; Quality #167 reached PostgreSQL/Redis integration and failed because a second controlled transport started while the first occupied an experiment concurrency cap of 1 (`expected 1, actual 2`);
- implementation commits `6da487b6eb7e31c1eccb6ed966efe2361cf88862` and `565e0b808fdab9bb3fafd7a82947f16d117dbaf4` added the run-serialized occupancy check, retryable saturation handling, and applied concurrency evidence;
- implementation Quality #173 passed fully;
- reconciled exact PR head `8c762a072586e5501ba4a0f08bba296d41838da6` preserved the already-published PR #38 Image-first history and passed full Quality #174;
- guarded merge produced `48155985b5e82591faef05e1822948b7aace7b37`;
- full merged-main Quality #175 passed for that exact SHA.

No schema, migration, second dispatcher, second worker path, live recipient, or external provider was introduced by the concurrency slice.

## Current milestone — experiment smooth pacing binding

Continue the delivery-control-plane work with the already-modeled experiment `pacingProfile` / `pacingIntervalMs` values, starting with **smooth interval binding only**.

The required boundary is:

- reuse the existing Redis dispatcher/pacing owner rather than introducing a second pacing engine;
- an approved smooth experiment interval is an additional run-wide minimum transport-start gap, so provider rotation cannot bypass it;
- provider, provider-rate-group, sender-domain, account, campaign, warm-up, adaptive slowdown, quota and safety controls remain authoritative and may only make transport slower or more constrained;
- experiment pacing must never disable or relax the existing production pacing checks;
- when the experiment interval is the blocking condition, persist the next eligible time through the existing campaign safety-wait mechanism so the worker does not hot-loop the same delivery every pump cycle;
- successful `transport.started` evidence must record the applied experiment pacing profile, configured interval and effective minimum experiment interval;
- use isolated mock-provider/controlled-recipient proof only; no live recipient or external provider;
- do not combine `bounded-burst` semantics into this first pacing slice. Prove smooth interval binding first, then reconcile bounded-burst separately against the still-authoritative production ceilings.

Start red-first from this verified baseline: demonstrate that the currently modeled smooth interval does not yet prevent an immediate second transport start, then implement only the minimum dispatcher/engine/evidence changes required to turn that boundary green.

## Image-first boundary

Image-first parity plus the concrete primary-image CTA correction are published on verified `main`. Do not reopen that work unless a new specific repository/test/provider-compatibility gap is observed. No live recipient or external provider may be used for automated proof.

## Delivery-control-plane follow-on

After smooth pacing binding is published, continue from repository truth in dependency order:

- reconcile and prove the remaining `bounded-burst` pacing behavior without weakening production ceilings;
- bind approved standards-compliant transport encoding/charset and content-mode variables into the existing rendering/provider owners where repository truth still shows them as metadata-only;
- record effective applied experiment values and derived pacing state in tamper-evident evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider effective-rate/pressure/recovery telemetry and restart-durability proof;
- add privacy/retention controls and final experiment Activity/UX/export polish.

Experiments may vary behavior only inside the authorized envelope and must never silently route around a provider policy/enforcement decision.

## Later dependencies

After the dedicated delivery-control-plane completion slices:

- reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
- remaining campaign/Activity operational gaps found by current tests and UX review;
- final security, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before production installation.

The existing non-Docker installation path remains valid. Do not claim production VPS deployment complete until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
