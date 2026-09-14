# Current work

## Verified baseline

Remote `main` is verified at `763d095449e3181b3631203b3a9d9f6a32261ca9` (`feat(image): add primary image destination link (#38)`). Full merged-main Quality #172 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

## Completed product foundation

The verified system currently includes:

- the primary Providers → Blast → Activity product shell;
- provider catalog/configuration, verification, encrypted credentials, sender-domain authorization, stable sender identities, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- inline-vs-attachment provider message semantics and Content-ID support across SMTP, SES raw MIME, Resend, SendGrid, Postmark, Mailjet, and Mailgun, with fail-closed behavior for unsupported API transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image replace/remove, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the verified optional primary-image destination link from PR #38;
- Image-first destination URLs accept only complete HTTP(S) destinations, preserve unlinked markup when empty, use the existing campaign link/tracking pipeline when enabled, and reject unsafe schemes such as `javascript:` without adding another tracking or redirect owner.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Current milestone — experiment run-wide concurrency binding

Draft PR #37 (`feat/experiment-concurrency-binding`) is the first dedicated delivery-control-plane binding slice after the verified Image-first work. It is intentionally limited to the already-modeled experiment `concurrency` variable and reuses the existing delivery engine, experiment reservation owner, dispatcher, safety governor, and evidence chain.

The verified candidate contract is:

- an authorized experiment concurrency value is enforced as a run-wide transport-start cap across workers and eligible providers immediately before transport starts;
- existing provider/account/domain/campaign ceilings remain authoritative and may only make the effective concurrency stricter;
- active experiment occupancy is derived from durable delivery attempts whose `transmissionStartedAt` is set and `finishedAt` is still null;
- the existing experiment run lock serializes competing reservations so a concurrent worker cannot start a second transport after the cap is occupied;
- saturation is temporary capacity pressure: it returns a retryable reservation denial, does not pause the campaign, does not consume an experiment attempt, and does not start transport;
- the existing non-transmitted finalizer restores quota/governor state, releases the provider reservation, decrements the provisional delivery attempt count, and leaves the delivery `DEFERRED` for later eligibility;
- non-retryable experiment scope/ceiling failures retain the existing fail-closed campaign-pause behavior;
- successful `transport.started` evidence records the applied experiment concurrency cap plus `activeBeforeStart` and `activeAfterStart` occupancy;
- no schema, migration, new dispatcher, new worker path, live recipient, or external provider is part of this slice.

TDD/verification evidence is explicit:

- test-only commit `1c095af7b1657b8806fd9d0c62b1506bb9f853a8`, exact parent `849b4c1fc5f7f09f0a9124a451817b65a5a66214`, added one PostgreSQL/Redis integration contract with provider concurrency 10 and authorized experiment concurrency 1;
- Quality #167 passed migrations/schema, upgrade rehearsal, lint, secrets, strict TypeScript and unit tests before failing at integration because the second controlled transport started while the first was held open (`expected 1, actual 2`), establishing the intended behavior red;
- implementation commit `6da487b6eb7e31c1eccb6ed966efe2361cf88862` added the run-serialized pre-transport occupancy check and retryable saturation result in `reserveExperimentTransport()`;
- implementation commit `565e0b808fdab9bb3fafd7a82947f16d117dbaf4` integrated retryable handling into the existing engine and added applied concurrency/occupancy to `transport.started` evidence;
- full Quality #173 passed for exact implementation head `565e0b808fdab9bb3fafd7a82947f16d117dbaf4`, including the formerly-red PostgreSQL/Redis integration test, build, Playwright, screenshots, production-container validation, diagnostics/artifacts, cleanup, and shutdown.

This documentation checkpoint changes no runtime behavior. Publication still requires full Quality on the final reconciled PR #37 head, confirmation that remote `main` remains at the expected verified PR #38 baseline, a guarded exact-head merge, and merged-main Quality on the resulting SHA.

## Image-first boundary

Image-first parity plus the concrete primary-image CTA correction are published on verified `main`. Do not reopen that work unless a new specific repository/test/provider-compatibility gap is observed. No live recipient or external provider may be used for automated proof.

## Delivery-control-plane follow-on

After the concurrency milestone is published, continue from repository truth in dependency order:

- bind approved experiment pacing behavior (`pacingProfile` / `pacingIntervalMs`) into the existing dispatcher/pacing owners while preserving production/account/domain/provider ceilings;
- then bind approved standards-compliant transport encoding/charset and content-mode variables into the existing rendering/provider owners where repository truth still shows them as metadata-only;
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
