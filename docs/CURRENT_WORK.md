# Current work

## Verified baseline

Remote `main` is verified at documentation checkpoint `631150eb97d12d42e805699b6d752494b6f2ba8c`; full Quality #192 passed for that exact SHA. The underlying published bounded-burst product merge is `8e80c4ff6077726291deed0dab6ed935c2c4d460`, with merged-main Quality #191 fully green.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, test-send path, or MIME stack.

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

PR #40 is published at `8e80c4ff6077726291deed0dab6ed935c2c4d460`; merged-main Quality #191 passed fully. Documentation checkpoint `631150eb97d12d42e805699b6d752494b6f2ba8c` then passed Quality #192.

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

## Current milestone — explicit transport encoding + UTF-8 charset

PR #41 (`feat/experiment-transport-encoding-binding`) is a **verified candidate, not yet published**. Its exact implementation head `f424afb942aa7b90271f15eab730cd9b6fccafdd` passed full Quality #200, including fresh migrations, schema/drift and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, screenshots, production-container validation, diagnostics, artifact upload, cleanup, and shutdown.

Canonical evidence:

- verified parent `631150eb97d12d42e805699b6d752494b6f2ba8c` passed Quality #192;
- `c8ac5c14734e8a0e8acf8755f833863e2b73b7f8` added the first provider-contract red; Quality #193 failed at strict TypeScript because `ProviderMessage` could not express `transportEncoding`;
- `537b8f2297dd383e64e78c968469cc727b26539a` added the bounded provider message contract for `provider-default`, `quoted-printable`, `base64`, and UTF-8; Quality #194 then reached the intended provider-behavior red;
- `804ab399c30911253c722761c824e2db8336b4a9` bound explicit encoding to the existing SMTP/Nodemailer and SES raw-MIME/MailComposer owners and made API-body transports fail closed; full provider-contract Quality #195 passed;
- `bdcc75dc9ae2d3a18da1e31a176112403e2d92ff` introduced the runtime test, while Quality #196 exposed a Custom-SMTP sender-authorization fixture problem in addition to the real missing runtime binding, so it is not the canonical runtime red;
- `0f5a69c7cd7b07d225731b1b6754b5ab0adabcc0` corrected the fixture to verified SES raw MIME plus an API-only scope; Quality #197 produced the clean runtime red: 94 integration tests passed and only message/evidence propagation plus incompatible-provider rejection failed;
- `a2cca56de67aa450d86ef624dd4c1c75270a4014` exposed the shared raw-MIME encoding capability helper; Quality #198 was superseded/cancelled;
- `53dc6f5832e09a4368a93ea7396fed509f653707` added profile-time rejection for incompatible explicit-encoding scopes; Quality #199 then passed that assertion and failed only because the actual delivery message still had `transportEncoding === undefined` instead of `base64`;
- `f424afb942aa7b90271f15eab730cd9b6fccafdd` completed the runtime binding through the existing campaign snapshot/delivery-message path and enriched the existing tamper-evident `transport.started` evidence; full Quality #200 passed.

Verified candidate contract:

- explicit non-default transfer encoding is permitted only where the existing transport owns raw MIME deterministically: SMTP and SES raw MIME;
- provider scopes containing API-body transports fail closed at experiment profile creation for explicit non-default encoding;
- the campaign snapshot stores the approved explicit `transportEncoding` and UTF-8 `charset`; existing `deliveryMessage()` remains the sole provider-message construction owner and naturally propagates those snapshot fields;
- SMTP uses Nodemailer's normal transfer-encoding option; SES uses the existing MailComposer raw-MIME path; no parallel MIME renderer was introduced;
- `transport.started` evidence records requested encoding, effective encoding, and UTF-8 charset; provider-default remains ordinary provider behavior and is not falsely reported as a deterministic explicit encoding;
- recipient allowlists, provider/sender scope, pacing/rate/quota/concurrency ceilings, suppression, policy enforcement, hard experiment limits, kill switch, and ordinary campaign behavior remain authoritative;
- no schema/migration, worker, second delivery engine, live recipient, or external provider change was introduced.

Publication is still gated on a fresh exact-head Quality after this documentation reconciliation, re-reading `main` and the PR head, guarded merge using the exact green head, and merged-main Quality on the resulting merge SHA.

## Next distinct dependency — content-mode binding

After PR #41 is published and its post-merge checkpoint is verified, continue red-first with `contentMode`. Reconcile each supported value (`html`, `text`, `cid-inline`, `hosted-image`, `attachment-only`, `image-dominant`) against the message structures and Image-first/CID owners that already exist. Do not fabricate unsupported conversions or introduce an experiment-only renderer. Bind the smallest deterministic mode first and record the effective applied content mode in experiment evidence.

## Delivery-control-plane follow-on

After content-mode binding is published, continue from repository truth in dependency order:

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
