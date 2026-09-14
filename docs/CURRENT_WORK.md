# Current work

## Verified baseline

Remote `main` is verified at `c57fd075831f359a546b63dc063c0634da31df91` (`docs: advance verified concurrency checkpoint`). Quality #176 passed fully for that exact SHA after the published experiment-concurrency milestone at `48155985b5e82591faef05e1822948b7aace7b37` / Quality #175.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

## Completed product foundation

The verified system on `main` includes:

- the primary Providers → Blast → Activity product shell;
- provider configuration/verification, encrypted credentials, sender authorization, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation, and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- verified experiment run-wide concurrency binding: the approved experiment cap is enforced immediately before transport start across workers/providers, saturation defers without pausing or consuming an experiment attempt, and `transport.started` evidence records applied occupancy while stricter production ceilings remain authoritative;
- inline-vs-attachment provider message semantics and Content-ID support across supported SMTP/API transports, with fail-closed behavior for unsupported inline transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the verified optional primary-image HTTP(S) destination link.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Current candidate — experiment smooth pacing binding

PR #39 (`feat/experiment-smooth-pacing-binding`) is a fully verified candidate but is **not yet published on `main`**.

Canonical evidence:

- corrected red test commit `5d1f677b3f3f166a4103dd6f060a445b98cd9f04` established the intended behavior boundary after an earlier invalid fixture was discarded;
- Quality #178 passed migrations, schema/upgrade rehearsal, lint, secret scan, strict typecheck and unit tests, then failed exactly at PostgreSQL/Redis integration because both controlled transports started inside an approved 60-second smooth experiment interval (`actual 2`, `expected 1`);
- `ca05694130ad45e906b9ba82ce78c0017138e9b5` added an atomic Redis run-wide smooth-pacing permit using Redis server time, a tokenized pre-transport reservation, commit semantics, and owner-only release for an unstarted permit;
- `627dc2a30aeb1a211fadd7e5f09474557470e201` bound the permit into the existing delivery engine, reusing campaign `safetyWaitUntil`/`safetyWaitReason`, preserving existing provider/domain/account/campaign/warm-up/adaptive controls, and recording applied pacing values in `transport.started` evidence;
- `7a6c0f994e50561a8793a8fd1e5135892d6f65d5` added direct Redis race proof: concurrent callers produce exactly one permit winner, a committed permit preserves the interval, a non-owner cannot release another worker's reservation, and the owning unstarted reservation can be released cleanly;
- Quality #181 passed fully on exact head `7a6c0f994e50561a8793a8fd1e5135892d6f65d5`, including fresh migrations, drift/schema and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The implemented smooth-pacing contract is deliberately narrow:

- only `pacingProfile: "smooth"` plus positive `pacingIntervalMs` is bound in this slice;
- the interval is an additional run-wide minimum transport-start gap, so provider rotation cannot bypass it;
- provider, provider-rate-group, sender-domain, account, campaign, warm-up, adaptive slowdown, quota, suppression, policy and safety controls remain authoritative and may only make sending more constrained;
- when the experiment interval blocks a start, the existing campaign safety-wait path carries the Redis-derived next eligible time, avoiding a worker hot loop without creating or consuming a transport attempt;
- successful `transport.started` evidence records `profile`, `configuredIntervalMs`, and `effectiveMinimumIntervalMs`;
- pre-transport failure releases only the matching uncommitted experiment pacing permit; a committed start preserves its interval;
- no schema, migration, second dispatcher, second worker path, live recipient, or external provider was introduced.

Publication still requires a fresh exact-head Quality after this documentation reconciliation, re-reading the PR head and remote `main`, guarded merge of PR #39 only if those values remain exact, and merged-main Quality on the resulting SHA.

## Image-first boundary

Image-first parity plus the concrete primary-image CTA correction are published on verified `main`. Do not reopen that work unless a new specific repository/test/provider-compatibility gap is observed. No live recipient or external provider may be used for automated proof.

## Delivery-control-plane follow-on

After smooth pacing is published, continue from repository truth in dependency order:

- reconcile and prove the remaining `bounded-burst` experiment pacing behavior without weakening production ceilings;
- bind approved standards-compliant transport encoding/charset and content-mode variables into the existing rendering/provider owners where repository truth still shows them as metadata-only;
- record remaining effective applied experiment values and derived pacing state in tamper-evident evidence;
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
