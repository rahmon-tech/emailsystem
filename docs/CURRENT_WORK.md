# Current work

## Verified baseline

Remote `main` is verified at `e3eb700b213484dba3f195ea2dbdaacc22366b0d` (`docs: advance verified smooth pacing checkpoint`). Quality #185 passed fully for that exact SHA after the smooth-pacing publication at `c797f5732e7a513f1b646b7458cc42a5929b62e2` / Quality #184.

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

- corrected red test commit `5d1f677b3f3f166a4103dd6f060a445b98cd9f04` established the intended behavior boundary;
- Quality #178 failed exactly at PostgreSQL/Redis integration because two controlled transports started inside the approved 60-second smooth interval (`actual 2`, `expected 1`);
- `ca05694130ad45e906b9ba82ce78c0017138e9b5` added atomic Redis run-wide smooth-pacing permits with Redis server time and tokenized reservation/commit/release semantics;
- `627dc2a30aeb1a211fadd7e5f09474557470e201` bound that permit into the existing delivery engine and safety-wait/evidence paths;
- `7a6c0f994e50561a8793a8fd1e5135892d6f65d5` added direct Redis race proof;
- reconciled exact PR head `09bd23ca39f5077fea99a063c8fc03652211558e` passed full Quality #183;
- guarded merge produced `c797f5732e7a513f1b646b7458cc42a5929b62e2`, and merged-main Quality #184 passed fully;
- docs checkpoint `e3eb700b213484dba3f195ea2dbdaacc22366b0d` passed full Quality #185.

The published contract is deliberately narrow: only `pacingProfile: "smooth"` plus positive `pacingIntervalMs` is bound. Every production provider/rate-group/sender-domain/account/campaign/warm-up/adaptive/quota/suppression/policy/safety control remains independently authoritative.

## Current candidate — bounded-burst pacing binding

PR #40 (`feat/experiment-bounded-burst-binding`) is a fully verified candidate but is **not yet published on `main`**.

Canonical TDD and implementation evidence:

- test-only commit `3fae05dc630eb27d7475b94fb1fc1c7cbdafb9fc` established a controlled three-recipient contract with a 60-second window and burst size 2;
- Quality #186 passed all earlier gates and failed exactly at PostgreSQL/Redis integration because the strict experiment-variable model rejected the previously nonexistent `pacingBurstSize` key;
- `57a0da91a9bb0d929d691e373106ffa4fe8ab73d` added a positive bounded `pacingBurstSize`, requires it together with a positive interval for `bounded-burst`, and rejects burst size on the smooth profile;
- Quality #187 then passed the model boundary and failed exactly at runtime because all three controlled transports started (`actual 3`, `expected 2`), proving the metadata-only profile still did not enforce the run-wide window;
- `1bef0f53b53deaa38eabb11e2b75e6130cf85d38` added the bounded-burst runtime binding: atomic Redis server-time coordination, tokenized unstarted reservations, commit semantics, owner-only release, durable campaign safety-wait on a full window, and applied burst evidence through the existing experiment reservation/evidence owners;
- `9d396319a512591d56ed2f69a283c95b0071c9e1` added direct Redis race proof: 24 concurrent callers against burst size 3 admit exactly three, committed starts cannot be released from the window, a non-owner cannot release another worker's unstarted reservation, and the owner can release it cleanly;
- full Quality #189 passed on exact head `9d396319a512591d56ed2f69a283c95b0071c9e1`, including fresh migrations, schema/drift and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The candidate contract is deliberately bounded:

- `pacingIntervalMs` is the run-wide burst-window duration and `pacingBurstSize` is the maximum experiment transport starts admitted in that window;
- Redis coordination is scoped to tenant + experiment run, so workers and provider rotation cannot multiply the approved burst;
- a full window writes the Redis-derived next eligible time through the existing campaign `safetyWaitUntil` / `safetyWaitReason` path and returns retryably without consuming an experiment attempt;
- successful `transport.started` evidence records `profile`, `windowMs`, `burstSize`, `occupancyBeforeStart`, and `occupancyAfterStart`;
- existing provider, provider-rate-group, sender-domain, account, campaign, warm-up, adaptive, quota, concurrency, suppression, policy, kill-switch and safety controls remain independently authoritative and may only reduce/spread the nominal burst;
- no database schema/migration, second delivery engine, second worker path, live recipient, or external provider was introduced.

Publication still requires this documentation reconciliation, a fresh exact-head Quality, re-reading the PR head and remote `main`, guarded merge only if both remain exact, and merged-main Quality on the resulting SHA.

## Image-first boundary

Image-first parity plus the concrete primary-image CTA correction are published on verified `main`. Do not reopen that work unless a new specific repository/test/provider-compatibility gap is observed. No live recipient or external provider may be used for automated proof.

## Delivery-control-plane follow-on

After bounded-burst pacing is published, continue from repository truth in dependency order:

- bind approved standards-compliant `transportEncoding`, UTF-8 `charset`, and `contentMode` experiment variables into the existing rendering/MIME/provider owners where repository truth still shows them as metadata-only;
- record remaining effective applied experiment values and derived state in tamper-evident evidence;
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
