# Delivery Control Plane & Authorized Resilience Experiments

This document is the canonical product/engineering addendum for EmailSystem's adaptive multi-provider delivery control plane and its explicitly authorized resilience-testing capabilities. It exists so requirements survive implementation slices without creating parallel systems.

## Product intent

EmailSystem is not a queue that hands an entire recipient list to providers as fast as possible. The delivery engine must absorb campaigns quickly, then release actual transport attempts at a controlled, observable, tenant-safe pace.

Authorized resilience experiments reuse the production delivery engine and provider integrations; they are not a second product or a separate sender. Experiment behavior must be explicit, scoped, bounded, observable, and auditable. Provider policy/enforcement blocks remain fail-closed states and must never be silently converted into enforcement circumvention.

## Production delivery engine

### Multi-provider routing

- Preserve weighted fair provider selection instead of draining one provider before moving to the next.
- Route only across eligible, healthy, sender-authorized connections.
- Respect provider quota, concurrency, per-second/per-minute limits, daily budgets, cooldowns, regions, and sender authorization.
- Temporary availability/rate pressure may make a provider ineligible until cooldown expires.
- Policy/enforcement blocks are not ordinary failover signals.

### Sender-domain pacing

- All provider connections used by the same tenant + sender domain share a provider-independent pacing ceiling.
- Adding providers must not automatically multiply sender-domain burst rate.
- Smooth pacing is preferred for production traffic; configured ceilings remain hard upper bounds.
- Campaign, sender-domain, account, provider, warm-up and adaptive controls may all participate in the final transport-start decision.
- Queue discovery speed remains separate from transport-start speed.

### Adaptive pacing and backoff

- Track effective rate separately from configured ceilings.
- Provider `429`, `Retry-After`, transient failures, deferrals, connection pressure, and recent unhealthy outcomes may reduce effective pace or create cooldowns.
- Healthy history may recover pace gradually; adaptation may never raise throughput above configured ceilings.
- Prefer conservative congestion-style behavior: reduce quickly under pressure, recover gradually.
- Persist or derive adaptation from durable attempt history where practical so worker restart does not erase pressure evidence.
- Compute/record `nextAllowedAt`-style decisions rather than hot-looping ineligible jobs.

### Warm-up / soft start

- Support explicit Conservative, Balanced, and High-capacity-within-policy profiles.
- Warm-up is scoped at least to tenant + sender domain, not independently per provider.
- Newly active/high-rate sender domains ramp toward configured ceilings instead of beginning with an immediate high burst.
- Long enough inactivity returns a sender domain to an appropriate soft-start state.
- Warm-up profiles must be inspectable and unable to exceed configured limits.

### Feedback brakes

Inputs may include provider acceptance/rejection categories, rate-limit responses/retry hints, temporary SMTP/API errors, hard/soft bounces, complaints/unsubscribes, authenticated provider events, provider health/quota state, and campaign/account safety state.

The resulting action must remain explicit: continue, slow down, cool down, temporarily remove provider, pause campaign, pause account, or require review.

### Truthful delivery state

- Provider/API/SMTP acceptance is not mailbox delivery.
- Generic SMTP acceptance remains delivery-unconfirmed unless an authoritative downstream signal exists.
- Authenticated provider events or another authoritative delivery signal may move durable state to `DELIVERED`.
- Open/click tracking must never be used as delivery confirmation.

## Activity and observability

Activity should make the control plane understandable without exposing secrets or recipient data unnecessarily. Show, where evidence exists: intended/completed/remaining recipients, observed messages/minute from real starts, evidence-backed ETA, active/eligible provider count, cooldown/pressure, configured versus effective pace, warm-up profile/stage, safety waits/policy-review state, and the last meaningful pacing decision/reason. Never invent an ETA when dispatch is idle or evidence is stale.

## Authorized resilience experiment mode

Authorized experiments reuse the same core delivery engine and are represented as explicit run/profile state so intent, scope, and evidence remain distinguishable from ordinary campaigns.

### Scope metadata and controlled recipients

Each experiment records authorization/reference metadata, tenant/account, provider/sender scope, controlled recipients, start/end window, maximum recipients/attempts/duration, allowed variables, stop conditions, operator metadata, and immutable profile/version identity.

- Support explicit controlled-recipient allowlists where required.
- Prevent accidental expansion beyond configured experiment scope.
- Preserve suppression, sender authorization, provider enforcement and safety controls unless an approved test contract changes a benign variable inside the authorized envelope.

### Experiment profiles

Profiles may vary legitimate parameters such as:

- pacing interval/effective rate inside configured ceilings;
- bounded-burst versus smooth pacing profiles;
- provider selection/rotation weights where separately implemented and authorized;
- concurrency inside configured ceilings;
- retry timing/cooldown behavior where separately implemented and authorized;
- provider-supported transport configuration;
- standards-compliant MIME transfer encoding and charset;
- HTML/text/image-first content mode;
- attachment versus inline-image transport.

Experiments measure provider consistency/resilience. They must not conceal messages from the provider that must transmit them or silently route around policy blocks.

### Verified run-wide concurrency contract

The approved experiment concurrency cap is enforced immediately before transport start across workers/providers. Saturation is retryable, does not pause the campaign, does not consume an experiment attempt, and records applied occupancy in `transport.started` evidence. Production ceilings remain independently authoritative.

### Verified smooth-pacing contract

For `pacingProfile: "smooth"`, positive `pacingIntervalMs` is an additional run-wide minimum transport-start gap coordinated atomically in Redis using server time. Provider rotation and multiple workers cannot bypass it. Blocked starts reuse the campaign safety-wait owner and do not consume an experiment attempt. Evidence records the applied profile, configured interval, and effective minimum interval.

### Verified bounded-burst contract

For `pacingProfile: "bounded-burst"`, the profile requires both a positive `pacingIntervalMs` and an explicit positive bounded `pacingBurstSize`.

- `pacingIntervalMs` is the run-wide burst-window duration.
- `pacingBurstSize` is the maximum experiment transport starts admitted in that window.
- Redis server time and atomic coordination scope the window to tenant + experiment run, so workers/providers cannot multiply capacity through races or provider rotation.
- Unstarted slots use tokenized reservation/commit/release semantics; only the owning token may release an uncommitted reservation, while committed starts remain charged to the active window.
- A full window defers through the existing campaign `safetyWaitUntil` / `safetyWaitReason` path to the Redis-derived next window without consuming an experiment attempt.
- Provider, provider-rate-group, sender-domain, account, campaign, warm-up, adaptive, quota, concurrency, suppression, policy, kill-switch and safety controls remain independently authoritative and may only reduce/spread the nominal burst.
- `transport.started` evidence records `profile`, `windowMs`, `burstSize`, `occupancyBeforeStart`, and `occupancyAfterStart`.

### Stop conditions and kill switch

- Every experiment has hard volume/time ceilings.
- The account/admin kill switch stops new experiment transport starts.
- Provider policy/enforcement responses are captured as evidence.
- Normal behavior is fail-closed on policy block.
- Any authorized continuation after enforcement remains explicit, scoped and auditable rather than automatic rerouting.

## Evidence capture

Persist enough safe evidence to reproduce each relevant experiment/pacing observation without leaking secrets, including profile/version, provider identity/type/transport, safe tenant/sender identifiers, campaign/delivery/attempt IDs, timestamps, configured ceilings, applied experiment controls, effective pacing gap/rate where known, provider pressure/cooldown, safe response category/details, retry hints, durable state transitions, policy/health transitions, stop reason, and outcome classification.

Evidence/audit records should be append-only or otherwise tamper-evident at the application level.

For pacing evidence:

- smooth pacing records the applied profile, configured interval, and effective minimum interval;
- bounded-burst pacing records the applied profile, configured window duration, configured burst size, and run-wide occupancy before/after each admitted start.

Remaining experiment variables must likewise record their effective applied values/derived state when they become runtime-bound so runs remain reproducible.

## Privacy and platform-internal obfuscation

The privacy goal is to minimize sensitive information inside EmailSystem, not hide a message from the transmitting provider.

- Keep provider credentials encrypted at rest and out of normal APIs/logs.
- Mask/hash recipient identifiers where full addresses are unnecessary.
- Redact provider responses before persistence/display.
- Avoid long-term message-body retention when not operationally required.
- Add explicit retention controls for experiment evidence/message snapshots.
- Keep secrets out of Git, CI artifacts, screenshots and support references.

## Standards-compliant encoding

EmailSystem should support normal email/MIME compatibility: UTF-8 normalization, quoted-printable where appropriate, base64 for binary content where appropriate, correct MIME boundaries/content types, attachment encoding, inline CID, multipart structures, and deterministic HTML/text rendering. Encoding choices used by experiments must be captured in evidence.

Experiment encoding work must reuse the existing renderer/MIME/provider owners. It must not create anti-filter obfuscation, a parallel MIME stack, or a second sender path. An explicitly required encoding that cannot be honored by a transport must fail closed rather than silently pretending it was applied.

## Content modes

Experiment `contentMode` must map only to message structures actually supported by the existing renderer/provider model. HTML, text, CID-inline, hosted-image, attachment-only, and image-dominant modes may be bound incrementally where repository truth shows a real owner and deterministic representation.

Do not fabricate unsupported conversions or create an experiment-only renderer. Image-first and CID behavior continue to reuse the verified campaign/delivery architecture.

## Image-first message mode

Image-first sending is a supported content format, not an anti-filter bypass mechanism. Verified `/blast/image` currently covers the CID-inline product flow through the existing campaign/delivery engine, including asset lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text fidelity, and an optional ordinary HTTP(S) destination link behind the primary image. Those links reuse the existing campaign tracking pipeline when enabled.

Preserve safe formats, bounded size/file counts, meaningful alt/plain-text alternatives, proven provider MIME compatibility, and preview of the actual message structure.

## Implementation status

### Verified/merged foundation on `main`

- weighted/fair multi-provider dispatcher with provider-specific rate/quota/concurrency grouping;
- provider-independent sender-domain smooth pacing plus explicit account/domain/campaign ceilings;
- domain soft-start/warm-up profiles that cannot exceed configured ceilings;
- provider cooldown/retry scheduling from temporary/rate-limit outcomes;
- truthful provider-acceptance versus delivery presentation;
- observed campaign pacing/ETA telemetry based on real transport starts;
- safety budgets, suppression, sender authorization, complaint/hard-bounce brakes, and fail-closed provider policy state;
- first-class authorized experiment profiles/runs with versioned authorization metadata, provider/sender scopes, controlled-recipient allowlists, bounded windows, hard recipient/attempt/duration ceilings, and account kill switch;
- experiment transport reservations that re-check run/window/provider/sender/recipient/hard ceilings immediately before transport;
- tamper-evident chained SHA-256 experiment evidence with transport-start/outcome records, run-scoped recipient hashes, integrity verification and tenant-safe JSON export;
- standards-compliant inline-vs-attachment semantics and CID compatibility across supported SMTP/API transports;
- verified Image-first CID product path including optional primary-image HTTP(S) destination link;
- verified experiment run-wide `concurrency` binding;
- verified experiment smooth-pacing binding;
- verified experiment bounded-burst pacing binding.

### Published pacing evidence

Smooth pacing PR #39 merged at `c797f5732e7a513f1b646b7458cc42a5929b62e2`; merged-main Quality #184 passed and checkpoint `e3eb700b213484dba3f195ea2dbdaacc22366b0d` passed Quality #185.

Bounded-burst PR #40 followed red-first proof:

- Quality #186 failed because `pacingBurstSize` was not accepted by the strict experiment variable model;
- `57a0da91a9bb0d929d691e373106ffa4fe8ab73d` established the explicit profile contract;
- Quality #187 then failed because three transports started inside a configured two-start window (`actual 3`, `expected 2`);
- `1bef0f53b53deaa38eabb11e2b75e6130cf85d38` bound the atomic runtime control;
- `9d396319a512591d56ed2f69a283c95b0071c9e1` added direct cross-worker Redis race proof and passed full Quality #189;
- reconciled exact PR head `479627157cbc8709e38c3b7f05822b8d3fbeabf0` passed Quality #190;
- guarded merge produced `8e80c4ff6077726291deed0dab6ed935c2c4d460`;
- full merged-main Quality #191 passed on that exact SHA.

No schema/migration, second delivery engine, second worker path, live recipient, or external provider was introduced by either pacing binding.

### Current partially implemented / requires proof

- `transportEncoding`, UTF-8 `charset`, and `contentMode` experiment variables remain to be reconciled and runtime-bound through existing renderer/MIME/provider owners where repository truth still shows metadata-only behavior;
- provider adaptive slowdown state is consumed by the dispatcher and temporary/rate-limit cooldown is enforced, but the complete pressure → slowdown → gradual-recovery loop and restart durability still need focused end-to-end proof;
- eligible-provider failover exists, while dedicated proof must distinguish temporary unavailability failover from true policy-block fail-closed behavior;
- remaining effective experiment values must record applied values/derived state so runs are reproducible;
- privacy/retention controls and final experiment Activity/UX/export polish remain incomplete.

### Current next milestone — encoding/charset/content-mode binding

Before implementation, reconcile `transportEncoding`, `charset`, and `contentMode` against the actual renderer, MIME construction, provider message model, SMTP/raw-MIME paths, API adapters, Image-first/CID support, and test-message path.

Then proceed red-first in the smallest dependency-complete slices:

- prove one concrete metadata-only behavior gap before changing runtime behavior;
- keep UTF-8 standards-compliant;
- honor explicit transfer-encoding choices only where the current transport can deterministically apply them and fail closed where it cannot;
- bind content modes only to existing supported message structures rather than inventing a second rendering system;
- capture the effective applied values in tamper-evident evidence;
- preserve every existing scope, policy, suppression, safety and production-capacity control;
- use controlled recipients and mock/local transports only unless explicit live authorization is separately granted.

### Remaining major milestones

- publish encoding/charset/content-mode bindings through exact-head and merged-main Quality;
- finish remaining reproducibility/effective-value evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider pressure/slowdown/recovery telemetry and restart-durability proof;
- add privacy/retention controls for experiment evidence and message snapshots;
- finish experiment Activity/UX for configuration, live evidence, stop/review and export;
- maintain CI/security/tenant/race coverage for every new mutation path;
- complete final production hardening and VPS reconciliation only after repository Quality is green.

## Non-negotiable experiment boundary

Experiments may vary behavior only **inside** the authorized envelope; they may never expand it. Recipient allowlists, authorization metadata, provider/sender scope, configured production ceilings, suppression rules, complaint/bounce brakes, policy-block state, hard time/volume limits and kill switch remain authoritative regardless of experiment profile. Experimental behavior must never silently route around provider enforcement.

## Engineering rule

Do not implement this addendum as one monolithic change. Reconcile each slice against repository truth, preserve existing owners, add focused tests first, keep tenant/sender-domain boundaries explicit, run the full Quality pipeline, and merge narrow verified increments before moving to the next dependency.
