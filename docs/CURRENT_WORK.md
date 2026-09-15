# Current work

## Verified baseline

Remote `main` is verified at `8e80c4ff6077726291deed0dab6ed935c2c4d460` (`feat(experiment): bind bounded burst pacing (#40)`). Full merged-main Quality #191 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

## Completed product foundation

The verified system on `main` includes:

- the primary Providers → Blast → Activity product shell;
- provider configuration/verification, encrypted credentials, sender authorization, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation, and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- verified experiment run-wide concurrency binding;
- verified experiment smooth-pacing binding using atomic Redis coordination and durable safety-wait behavior;
- verified experiment bounded-burst binding using an explicit run-wide window + burst-size ceiling with atomic cross-worker Redis coordination;
- inline-vs-attachment provider message semantics and Content-ID support across supported SMTP/API transports, with fail-closed behavior for unsupported inline transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the optional primary-image HTTP(S) destination link.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Published pacing milestones

### Smooth pacing — PR #39

PR #39 is published at `c797f5732e7a513f1b646b7458cc42a5929b62e2`; merged-main Quality #184 passed and the resulting documentation checkpoint `e3eb700b213484dba3f195ea2dbdaacc22366b0d` passed Quality #185.

The contract is deliberately additive: positive experiment `pacingIntervalMs` is a run-wide minimum transport-start gap. Provider/rate-group/sender-domain/account/campaign/warm-up/adaptive/quota/suppression/policy/safety controls remain independently authoritative.

### Bounded-burst pacing — PR #40

PR #40 is published at `8e80c4ff6077726291deed0dab6ed935c2c4d460`; merged-main Quality #191 passed fully.

Canonical evidence:

- `3fae05dc630eb27d7475b94fb1fc1c7cbdafb9fc` established the controlled three-recipient, 60-second-window, burst-size-2 contract;
- Quality #186 failed at the intended model boundary because the strict experiment-variable schema did not yet accept `pacingBurstSize`;
- `57a0da91a9bb0d929d691e373106ffa4fe8ab73d` added the explicit positive bounded burst-size contract and profile compatibility validation;
- Quality #187 then failed at the intended runtime boundary because all three controlled transports started (`actual 3`, `expected 2`);
- `1bef0f53b53deaa38eabb11e2b75e6130cf85d38` added atomic Redis server-time burst admission, tokenized unstarted reservations, commit semantics, owner-only release, durable campaign safety-wait on a full window, and applied occupancy evidence through the existing delivery path;
- `9d396319a512591d56ed2f69a283c95b0071c9e1` added direct Redis race proof: 24 concurrent callers against burst size 3 admit exactly three, committed starts remain charged, a non-owner cannot release another worker's reservation, and an owning unstarted reservation can be released safely;
- full candidate Quality #189 passed on `9d396319a512591d56ed2f69a283c95b0071c9e1`;
- reconciled exact PR head `479627157cbc8709e38c3b7f05822b8d3fbeabf0` passed full Quality #190;
- guarded merge produced `8e80c4ff6077726291deed0dab6ed935c2c4d460`;
- merged-main Quality #191 passed fully on that exact SHA.

The published bounded-burst contract is additive only: `pacingIntervalMs` is the run-wide burst-window duration and `pacingBurstSize` is the maximum experiment transport starts admitted in the window. A full window uses the existing campaign `safetyWaitUntil` / `safetyWaitReason` owner and does not consume an experiment attempt. `transport.started` evidence records `profile`, `windowMs`, `burstSize`, `occupancyBeforeStart`, and `occupancyAfterStart`. Existing production ceilings, provider enforcement, suppression, kill-switch and safety controls remain authoritative. No schema/migration, second delivery engine, second worker path, live recipient, or external provider was introduced.

## Current milestone — transport encoding, charset, and content-mode binding

Repository truth still treats approved experiment `transportEncoding`, UTF-8 `charset`, and `contentMode` primarily as profile metadata. The next slice must reconcile those variables against the existing renderer, MIME construction, provider message model, SMTP/raw-MIME paths, API provider adapters, Image-first/CID support, and test-message path before changing behavior.

Execution rules for this milestone:

- begin from this exact verified baseline and preserve the existing rendering/provider owners;
- do not invent a parallel renderer, MIME stack, sender path, provider adapter family, or experiment-only message pipeline;
- use red-first tests to prove the first concrete metadata-only gap before implementation;
- keep `charset` standards-compliant and UTF-8; do not introduce non-standard obfuscation or anti-filter behavior;
- bind `transportEncoding` only where the existing transport owner can apply it correctly and fail closed where a provider path cannot honor an explicitly required encoding;
- bind `contentMode` to existing supported message structures rather than fabricating unsupported transformations; CID-inline, attachment, HTML/text, and Image-first behavior must continue to reuse their current owners;
- record effective applied encoding/charset/content-mode values in tamper-evident experiment evidence so a run is reproducible;
- preserve recipient allowlists, provider/sender scope, production pacing/rate/quota/concurrency ceilings, suppression, policy enforcement, hard experiment limits, and kill switch;
- use controlled recipients and mock/local transports only; no live recipient or external provider without explicit authorization.

Before coding, inspect current renderer/provider contracts and select the smallest dependency-complete slice. Prefer one narrow end-to-end variable binding at a time if repository truth shows materially different owners.

## Delivery-control-plane follow-on

After encoding/charset/content-mode binding is published, continue from repository truth in dependency order:

- finish remaining effective experiment-value/reproducibility evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider effective-rate/pressure/recovery telemetry and restart-durability proof;
- add privacy/retention controls for experiment evidence/message snapshots;
- finish experiment Activity/UX/export polish;
- run final security, tenant-isolation, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before claiming final production installation.

## Product boundaries

Image-first parity plus the primary-image destination-link correction are published and should not be reopened without a concrete repository/test/provider-compatibility gap.

Experiments may vary behavior only inside the authorized envelope and must never silently route around provider policy/enforcement decisions.

The existing non-Docker installation path remains valid. Do not claim production VPS deployment complete until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
