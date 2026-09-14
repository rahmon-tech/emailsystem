# Current work

## Verified baseline

Remote `main` is verified at `c797f5732e7a513f1b646b7458cc42a5929b62e2` (`feat(experiment): bind smooth pacing interval (#39)`). Full merged-main Quality #184 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

## Completed product foundation

The verified system on `main` includes:

- the primary Providers → Blast → Activity product shell;
- provider configuration/verification, encrypted credentials, sender authorization, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation, and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- verified experiment run-wide concurrency binding: the approved experiment cap is enforced immediately before transport start across workers/providers, saturation defers without pausing or consuming an experiment attempt, and `transport.started` evidence records applied occupancy while stricter production ceilings remain authoritative;
- verified experiment smooth-pacing binding: a positive approved `pacingIntervalMs` is enforced as an additional run-wide minimum transport-start gap using atomic Redis coordination; provider rotation cannot bypass it, blocked starts use the existing durable safety-wait path without consuming an attempt, and applied pacing values are recorded in tamper-evident evidence;
- inline-vs-attachment provider message semantics and Content-ID support across supported SMTP/API transports, with fail-closed behavior for unsupported inline transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the verified optional primary-image HTTP(S) destination link.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Verified smooth-pacing milestone

PR #39 (`feat/experiment-smooth-pacing-binding`) is published on verified `main`.

Canonical evidence:

- corrected red test commit `5d1f677b3f3f166a4103dd6f060a445b98cd9f04` established the intended behavior boundary after an earlier invalid fixture was discarded;
- Quality #178 passed migrations, schema/upgrade rehearsal, lint, secret scan, strict typecheck and unit tests, then failed exactly at PostgreSQL/Redis integration because both controlled transports started inside an approved 60-second smooth experiment interval (`actual 2`, `expected 1`);
- `ca05694130ad45e906b9ba82ce78c0017138e9b5` added an atomic Redis run-wide smooth-pacing permit using Redis server time, a tokenized pre-transport reservation, commit semantics, and owner-only release for an unstarted permit;
- `627dc2a30aeb1a211fadd7e5f09474557470e201` bound that permit into the existing delivery engine, reusing campaign `safetyWaitUntil` / `safetyWaitReason`, preserving existing production controls, and recording applied pacing values in `transport.started` evidence;
- `7a6c0f994e50561a8793a8fd1e5135892d6f65d5` added direct Redis race proof: concurrent callers produce exactly one permit winner, a committed permit preserves the interval, a non-owner cannot release another worker's reservation, and the owning unstarted reservation can be released cleanly;
- Quality #181 passed fully on that implementation/race-proof head;
- reconciled exact PR head `09bd23ca39f5077fea99a063c8fc03652211558e` passed full Quality #183;
- guarded merge produced `c797f5732e7a513f1b646b7458cc42a5929b62e2`;
- full merged-main Quality #184 passed for that exact SHA.

The published contract is deliberately narrow: only `pacingProfile: "smooth"` plus positive `pacingIntervalMs` is bound. The interval is an additional run-wide floor; every provider/rate-group/sender-domain/account/campaign/warm-up/adaptive/quota/suppression/policy/safety control remains independently authoritative and may only make transport more constrained. No schema, migration, second dispatcher, second worker path, live recipient, or external provider was introduced.

## Current milestone — bounded-burst pacing contract and binding

Repository truth shows `pacingProfile: "bounded-burst"` is currently only metadata. `pacingIntervalMs` alone does not define a bounded burst because there is no explicit burst-size ceiling. Do not silently interpret `bounded-burst` as disabling production smooth pacing or as unlimited starts inside an interval.

The next slice must establish and prove this explicit contract before runtime binding:

- add an experiment variable `pacingBurstSize` as a positive bounded integer, required when `pacingProfile` is `bounded-burst` and rejected/ignored as appropriate for incompatible profile combinations;
- interpret `pacingIntervalMs` for `bounded-burst` as the run-wide burst-window duration and `pacingBurstSize` as the maximum experiment transport starts admitted in that window;
- coordinate the burst window atomically in the existing Redis delivery-control owner so workers/providers cannot multiply the burst by racing or rotating connections;
- treat this experiment window as an additional ceiling only: existing provider, provider-rate-group, sender-domain, account, campaign, warm-up, adaptive slowdown, quota, concurrency, suppression, policy and safety controls remain authoritative and may spread or further reduce the nominal burst;
- when the experiment burst window is full, use the existing campaign safety-wait mechanism with the Redis-derived next window time and do not create/consume an experiment transport attempt;
- successful `transport.started` evidence must record the applied profile, window duration, configured burst size, and occupancy before/after the admitted start;
- use controlled recipients and mock providers only; no live recipient or external provider;
- start red-first by proving that the current metadata-only `bounded-burst` profile neither validates an explicit burst cap nor enforces a run-wide window.

Because experiment profile variables are stored in the existing JSON variables payload, this contract should not require a database schema/migration unless repository truth proves otherwise.

## Image-first boundary

Image-first parity plus the concrete primary-image CTA correction are published on verified `main`. Do not reopen that work unless a new specific repository/test/provider-compatibility gap is observed. No live recipient or external provider may be used for automated proof.

## Delivery-control-plane follow-on

After bounded-burst pacing is published, continue from repository truth in dependency order:

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
