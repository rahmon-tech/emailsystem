# Delivery Control Plane & Authorized Resilience Experiments

This document is the canonical product/engineering addendum for EmailSystem's adaptive multi-provider delivery control plane and its authorized resilience-testing capabilities. It exists so these requirements are not lost between implementation slices.

## Product intent

EmailSystem is not just a queue that hands an entire recipient list to providers as fast as possible. The delivery engine must absorb large campaigns quickly, then release actual transport attempts at a controlled, observable, tenant-safe pace.

Explicitly authorized resilience experiments share the production delivery engine and provider integrations; they are not a second product or a separate sender. Experiment behavior must be explicitly scoped, observable, bounded, and auditable. A provider policy/enforcement block remains a distinct fail-closed state and must never be silently converted into enforcement circumvention.

## Production delivery engine

### Multi-provider routing

- Preserve weighted fair provider selection instead of draining one provider before moving to the next.
- Route only across eligible, healthy, sender-authorized connections.
- Respect provider quotas, concurrency, per-second/per-minute limits, daily budgets, cooldowns, regions, and sender authorization.
- Temporary availability/rate pressure may make a provider ineligible until cooldown expires.
- Policy/enforcement blocks are not ordinary failover signals.

### Sender-domain pacing

- All provider connections used by the same tenant + sender domain share a provider-independent pacing ceiling.
- Adding providers must not automatically multiply sender-domain burst rate.
- Smooth pacing is preferred over fixed-window bursts; configured ceilings remain hard upper bounds.
- Campaign, sender-domain, account, and provider limits should all be able to participate in the final send decision.
- Queue discovery speed must remain separate from transport-start speed.

### Adaptive pacing and backoff

- Track effective rate separately from configured ceilings.
- Provider `429`, `Retry-After`, transient failures, deferrals, connection pressure, and recent unhealthy outcomes may reduce effective pace or create cooldowns.
- Healthy history may recover pace gradually; adaptation must never increase throughput above configured limits.
- Prefer conservative congestion-style behavior: reduce quickly under pressure, recover gradually.
- Persist or derive adaptation from durable attempt history where possible so worker restart does not erase pressure evidence.
- Compute/record `nextAllowedAt`-style pacing decisions rather than hot-looping ineligible jobs.

### Warm-up / soft start

- Support configurable Conservative, Balanced, and High-capacity-within-policy profiles.
- Warm-up is scoped at least to tenant + sender domain, not independently per provider.
- Newly active/high-rate sender domains ramp toward configured ceilings rather than beginning with an immediate high burst.
- Long enough inactivity should return the domain to an appropriate soft-start state.
- Warm-up profiles must be explicit, inspectable, and unable to exceed configured limits.

### Feedback brakes

Inputs should include provider acceptance/rejection categories, rate-limit responses/retry hints, temporary SMTP/API errors, hard/soft bounces, complaints/unsubscribes, authenticated provider events, provider health/quota state, and campaign/account safety state.

The resulting action must be explicit: continue, slow down, cool down, temporarily remove provider, pause campaign, pause account, or require review.

### Truthful delivery state

- Provider/API/SMTP acceptance is not mailbox delivery.
- Generic SMTP acceptance remains delivery-unconfirmed unless an authoritative downstream signal exists.
- Authenticated provider events or another authoritative delivery signal may move durable state to `DELIVERED`.
- Open/click tracking must never be used as delivery confirmation.

## Activity and observability

Activity should make the control plane understandable without exposing secrets or recipient data unnecessarily. Show, where evidence exists: intended/completed/remaining recipients, observed messages/minute from real starts, evidence-backed ETA, active/eligible provider count, cooldown/pressure, configured versus effective pace, warm-up profile/stage, safety waits/policy-review state, and the last meaningful pacing decision/reason. Never invent an ETA when dispatch is idle or evidence is stale.

## Authorized resilience experiment mode

Authorized experiments reuse the same core delivery engine and are represented as explicit run/profile state so intent, scope and evidence remain distinguishable from ordinary campaigns.

### Scope metadata and controlled recipients

Each experiment records authorization/reference metadata, tenant/account, provider/sender scope, controlled recipients, start/end window, maximum recipients/attempts/duration, allowed variables, stop conditions, operator metadata, and immutable profile/version identity.

- Support explicit controlled-recipient allowlists where required.
- Prevent accidental expansion beyond configured experiment scope.
- Preserve suppression, sender authorization, policy and safety controls unless an approved test contract changes a benign test parameter inside the authorized envelope.

### Experiment profiles

Profiles may vary legitimate parameters such as:

- pacing interval/effective rate inside configured ceilings;
- bounded-burst versus smooth pacing profiles;
- provider selection/rotation weights;
- concurrency inside configured ceilings;
- retry timing/cooldown behavior;
- provider-supported transport configuration;
- standards-compliant MIME transfer encoding and charset;
- HTML/text/image-first content mode;
- attachment versus inline-image transport.

For `bounded-burst`, the profile must be explicit enough to be mechanically bounded. `pacingIntervalMs` alone is insufficient; the contract also requires a positive `pacingBurstSize`, interpreted as the maximum experiment transport starts admitted in one run-wide interval. That experiment limit is additive only and may never relax provider, sender-domain, account, campaign, warm-up, adaptive, quota, concurrency, suppression, policy or safety controls.

Experiments measure provider consistency/resilience. They must not conceal messages from the provider that must transmit them or silently route around policy blocks.

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
- verified experiment `concurrency` binding: run-wide across workers/providers, retryable saturation without attempt consumption, with applied occupancy evidence while production ceilings remain authoritative;
- verified experiment smooth pacing binding: positive `pacingIntervalMs` is enforced as an additional run-wide transport-start floor using atomic Redis server-time coordination, blocked starts use the existing campaign safety-wait path without consuming an experiment attempt, and tamper-evident `transport.started` evidence records applied pacing values.

### Verified smooth-pacing publication

PR #39 is published on `main` at `c797f5732e7a513f1b646b7458cc42a5929b62e2`.

The corrected TDD red was Quality #178 on `5d1f677b3f3f166a4103dd6f060a445b98cd9f04`, which failed because two transports started inside the configured 60-second interval (`actual 2`, `expected 1`). Implementation/race-proof head `7a6c0f994e50561a8793a8fd1e5135892d6f65d5` passed full Quality #181. Reconciled exact PR head `09bd23ca39f5077fea99a063c8fc03652211558e` passed full Quality #183. Guarded merge produced `c797f5732e7a513f1b646b7458cc42a5929b62e2`, full merged-main Quality #184 passed, and the resulting documentation checkpoint `e3eb700b213484dba3f195ea2dbdaacc22366b0d` passed full Quality #185.

The implementation uses Redis server time and atomic Lua permit acquisition, tokenized pre-start reservation/commit/release semantics, the existing campaign safety-wait path, and the existing production dispatcher. Direct race proof verifies one concurrent permit winner and owner-only release of an uncommitted reservation. No schema/migration or second dispatcher/worker path was introduced.

### Verified candidate — PR #40 bounded-burst pacing binding

PR #40 at `9d396319a512591d56ed2f69a283c95b0071c9e1` has passed full Quality #189 but is not yet published on `main`.

The candidate binds `pacingProfile: "bounded-burst"` with a positive `pacingIntervalMs` window and explicit positive `pacingBurstSize` as an additional run-wide transport-start ceiling. The implementation:

- validates the variable contract explicitly, requiring both a positive window and bounded burst size for `bounded-burst` and rejecting burst size on the smooth profile;
- uses Redis server time plus atomic Lua coordination so workers/providers cannot multiply the run-wide burst by racing or rotating connections;
- uses tokenized unstarted reservations, commit semantics, and owner-only release, while committed starts remain charged to the active window;
- writes the Redis-derived next eligible time through the existing campaign safety-wait owner when the burst is full, without consuming an experiment attempt;
- preserves provider, provider-rate-group, sender-domain, account, campaign, warm-up, adaptive, quota, concurrency, suppression, policy, kill-switch and safety controls as independently authoritative;
- records `profile`, `windowMs`, `burstSize`, `occupancyBeforeStart`, and `occupancyAfterStart` in tamper-evident `transport.started` evidence;
- has direct race proof that 24 concurrent callers with burst size 3 admit exactly three, committed slots cannot be released from the window, a non-owner cannot release another worker's unstarted reservation, and the owner can release it cleanly;
- required no database schema/migration, second delivery engine, second worker path, live recipient, or external provider.

TDD evidence is explicit: Quality #186 failed at PostgreSQL/Redis integration because `pacingBurstSize` was not yet accepted by the strict variable schema; after the model contract was added, Quality #187 failed because all three controlled transports started inside a configured two-start window (`actual 3`, `expected 2`). Full candidate Quality #189 is green on `9d396319a512591d56ed2f69a283c95b0071c9e1`. Publication still requires reconciled exact-head Quality, guarded merge, and merged-main Quality.

### Partially implemented / requires proof before claiming complete

- transfer encoding/UTF-8 charset and content-mode experiment variables remain to be bound into existing rendering/MIME/provider owners where repository truth shows metadata-only behavior;
- provider adaptive slowdown state is consumed by the dispatcher and temporary/rate-limit cooldown is enforced, but the complete pressure → slowdown → gradual-recovery loop and restart durability still need focused end-to-end proof;
- eligible-provider failover exists, while dedicated proof must still distinguish temporary unavailability failover from true policy-block fail-closed behavior;
- remaining effective experiment variables should record their applied values/derived state so runs are reproducible.

### Remaining major milestones

- publish the verified bounded-burst candidate after documentation reconciliation, exact-head Quality, guarded merge, and merged-main Quality;
- bind approved standards-compliant `transportEncoding`, UTF-8 `charset`, and `contentMode` variables into existing rendering/MIME/provider owners;
- add focused reproducibility/evidence proof for remaining effective experiment values and explicit temporary-failover-vs-policy-stop behavior;
- richer provider health/effective-rate/`nextAllowedAt` telemetry in Activity;
- privacy/retention controls for experiment evidence and message snapshots;
- final experiment Activity/UX for configuration, live evidence, stop/review and export;
- end-to-end CI/security/tenant/race coverage for every new mutation path;
- final production hardening and VPS reconciliation only after repository Quality is green.

## Non-negotiable experiment boundary

Experiments may vary behavior only **inside** the authorized envelope; they may never expand it. Recipient allowlists, authorization metadata, provider/sender scope, configured production ceilings, suppression rules, complaint/bounce brakes, policy-block state, hard time/volume limits and kill switch remain authoritative regardless of experiment profile. Experimental behavior must never silently route around provider enforcement.

## Engineering rule

Do not implement this addendum as one monolithic change. Reconcile each slice against repository truth, preserve existing owners, add focused tests first, keep tenant/sender-domain boundaries explicit, run the full Quality pipeline, and merge narrow verified increments before moving to the next dependency.
