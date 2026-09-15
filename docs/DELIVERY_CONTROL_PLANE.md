# Delivery Control Plane & Authorized Resilience Experiments

This document is the canonical product/engineering addendum for EmailSystem's adaptive multi-provider delivery control plane and explicitly authorized resilience-testing capabilities. Requirements are implemented as narrow slices through existing owners; experiments are never a second sender or a second product.

## Product intent

EmailSystem absorbs campaigns quickly and releases actual transport attempts at a controlled, observable, tenant-safe pace. Authorized experiments reuse the production delivery engine and provider integrations. Experiment behavior must be explicit, scoped, bounded, observable, auditable, and unable to silently route around provider policy/enforcement.

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

Activity should expose intended/completed/remaining recipients, observed messages/minute from real starts, evidence-backed ETA, active/eligible provider count, cooldown/pressure, configured versus effective pace, warm-up profile/stage, safety waits/policy-review state, and the last meaningful pacing decision where evidence exists. Never invent an ETA when dispatch is idle or evidence is stale. Avoid exposing secrets or recipient data unnecessarily.

## Authorized resilience experiment mode

Authorized experiments reuse the same core delivery engine and are explicit run/profile state so intent, scope, and evidence remain distinguishable from ordinary campaigns.

### Scope metadata and controlled recipients

Each experiment records authorization/reference metadata, tenant/account, provider/sender scope, controlled recipients, start/end window, maximum recipients/attempts/duration, allowed variables, stop conditions, operator metadata, and immutable profile/version identity.

- Support explicit controlled-recipient allowlists where required.
- Prevent accidental expansion beyond configured experiment scope.
- Preserve suppression, sender authorization, provider enforcement and safety controls unless an approved experiment changes a benign variable inside the authorized envelope.

### Experiment profiles

Profiles may vary legitimate parameters such as pacing interval/effective rate inside configured ceilings, bounded-burst versus smooth pacing, concurrency inside configured ceilings, provider-supported transport configuration, standards-compliant MIME transfer encoding/charset, and content structures already owned by the existing renderer/provider model. Provider selection/rotation weights or retry/cooldown behavior may vary only when separately implemented and authorized.

Experiments measure provider consistency/resilience. They must not conceal messages from the transmitting provider or bypass provider enforcement.

### Verified run-wide concurrency contract

The approved experiment concurrency cap is enforced immediately before transport start across workers/providers. Saturation is retryable, does not pause the campaign, does not consume an experiment attempt, and records applied occupancy in `transport.started` evidence. Production ceilings remain independently authoritative.

### Verified smooth-pacing contract

For `pacingProfile: "smooth"`, positive `pacingIntervalMs` is an additional run-wide minimum transport-start gap coordinated atomically in Redis using server time. Provider rotation and multiple workers cannot bypass it. Blocked starts reuse the campaign safety-wait owner and do not consume an experiment attempt. Evidence records the applied profile, configured interval, and effective minimum interval.

### Verified bounded-burst contract

For `pacingProfile: "bounded-burst"`, the profile requires a positive `pacingIntervalMs` and explicit positive bounded `pacingBurstSize`.

- `pacingIntervalMs` is the run-wide burst-window duration.
- `pacingBurstSize` is the maximum experiment transport starts admitted in that window.
- Redis server time and atomic coordination scope the window to tenant + experiment run so workers/providers cannot multiply capacity through races or rotation.
- Unstarted slots use tokenized reservation/commit/release semantics; only the owning token may release an uncommitted reservation, while committed starts remain charged.
- A full window defers through existing campaign `safetyWaitUntil` / `safetyWaitReason` state to the Redis-derived next window without consuming an experiment attempt.
- Production provider/rate-group/sender-domain/account/campaign/warm-up/adaptive/quota/concurrency/suppression/policy/kill-switch/safety controls remain independently authoritative and may only reduce/spread the nominal burst.
- `transport.started` evidence records `profile`, `windowMs`, `burstSize`, `occupancyBeforeStart`, and `occupancyAfterStart`.

### Published explicit transport-encoding contract — PR #41

PR #41 merged at `09234cf551897598365936a4fe5b214b6852b0fd`. Exact-head Quality #201 and merged-main Quality #202 passed fully.

- `transportEncoding` supports `provider-default`, `quoted-printable`, and `base64`; `charset` remains standards-compliant UTF-8.
- An explicit non-default encoding is allowed only on transports that deterministically own raw MIME: SMTP and SES raw MIME.
- API-body provider scopes fail closed at experiment-profile creation for explicit non-default encoding.
- The approved explicit encoding/charset is written into the existing immutable campaign message snapshot and reaches the existing `deliveryMessage()` / `ProviderMessage` path without a second renderer or sender.
- SMTP applies the existing Nodemailer encoding option; SES applies the existing MailComposer raw-MIME path.
- `transport.started` evidence records requested encoding, effective explicit encoding (or null for provider-default), and UTF-8 charset.
- Ordinary provider-default sending, production pacing, quotas, concurrency, suppression, policy blocks, hard experiment ceilings, and kill switch remain authoritative.
- No schema/migration, second delivery engine, second MIME stack, worker replacement, live recipient, or external provider was introduced.

Canonical PR #41 evidence: Quality #193 proved the message-model gap; #194 advanced to provider-behavior red; #195 passed the raw-MIME provider contract; #197 produced the clean runtime red after the non-canonical #196 fixture issue; #199 left only actual message propagation red; `f424afb942aa7b90271f15eab730cd9b6fccafdd` passed full Quality #200; reconciled head `827092c75ab883ee195348b1187de6f618928471` passed #201; guarded merge `09234cf551897598365936a4fe5b214b6852b0fd` passed merged-main #202.

### Stop conditions and kill switch

- Every experiment has hard volume/time ceilings.
- The account/admin kill switch stops new experiment transport starts.
- Provider policy/enforcement responses are captured as evidence.
- Normal behavior is fail-closed on policy block.
- Any authorized continuation after enforcement remains explicit, scoped, and auditable rather than automatic rerouting.

## Evidence capture

Persist enough safe evidence to reproduce each relevant observation without leaking secrets: profile/version, provider identity/type/transport, safe tenant/sender identifiers, campaign/delivery/attempt IDs, timestamps, configured ceilings, applied experiment controls, effective pacing gap/rate where known, provider pressure/cooldown, safe response category/details, retry hints, durable state transitions, policy/health transitions, stop reason, and outcome classification.

Evidence/audit records should be append-only or otherwise tamper-evident at the application level.

Current applied evidence includes:

- smooth pacing: profile, configured interval, effective minimum interval;
- bounded burst: profile, configured window, burst size, occupancy before/after an admitted start;
- explicit transport encoding: requested encoding, deterministic effective encoding where applicable, UTF-8 charset.

Remaining experiment variables must record effective applied values/derived state only when runtime proof exists; do not report metadata-only variables as effective behavior.

## Privacy and platform-internal obfuscation

The privacy goal is to minimize sensitive information inside EmailSystem, not hide a message from the transmitting provider.

- Keep provider credentials encrypted at rest and out of normal APIs/logs.
- Mask/hash recipient identifiers where full addresses are unnecessary.
- Redact provider responses before persistence/display.
- Avoid long-term message-body retention when not operationally required.
- Add explicit retention controls for experiment evidence/message snapshots.
- Keep secrets out of Git, CI artifacts, screenshots, and support references.

## Standards-compliant encoding

EmailSystem supports normal email/MIME compatibility: UTF-8 normalization, quoted-printable/base64 where appropriate, correct MIME boundaries/content types, attachment encoding, inline CID, multipart structures, and deterministic HTML/text rendering. Experiment encoding work must reuse existing renderer/MIME/provider owners and must not create anti-filter obfuscation or a parallel MIME stack. An explicitly required encoding that cannot be honored fails closed.

## Content modes

Experiment `contentMode` values are `html`, `text`, `cid-inline`, `hosted-image`, `attachment-only`, and `image-dominant`, but they are not all runtime-bound merely because the profile schema accepts them. Each mode must map only to message structures actually supported by existing campaign/renderer/provider owners.

### Current first slice — `cid-inline`

Repository truth makes `cid-inline` the smallest deterministic content-mode binding:

- campaign attachment validation already requires a safe Content-ID for inline assets, forbids Content-ID on ordinary attachments, and rejects duplicate inline IDs;
- existing preflight already verifies every HTML `cid:` reference has a matching inline attachment and every inline attachment is referenced;
- campaigns containing inline attachments already filter providers through `supportsInlineAttachmentTransport`;
- `/blast/image` already produces the exact HTML + matching-inline-attachment structure;
- verified SMTP/SES/supported API adapters already preserve inline CID semantics.

The bounded `cid-inline` contract is therefore:

- a `contentMode: "cid-inline"` experiment profile must use provider scopes whose transports support inline CID; incompatible scopes fail closed before campaign mutation;
- a campaign bound to such a run must contain at least one real inline attachment with a safe Content-ID referenced by its HTML;
- existing preflight remains authoritative for CID reference matching, provider eligibility, attachment bounds, sender authorization, suppressions, tracking/reputation, safety, and campaign readiness;
- no experiment-only renderer or conversion is introduced;
- successful `transport.started` evidence may report `effectiveMode: "cid-inline"` only when the stored campaign snapshot proves the structure; otherwise it must not claim effective application;
- the other content modes remain metadata-only until separately reconciled and bound.

Do not start content-mode work by pretending `text` is already text-only: `ProviderMessage` currently requires both HTML and text and API adapters ordinarily send both. Likewise do not fabricate hosted-image, attachment-only, or image-dominant conversions.

## Image-first message mode

Image-first is a supported content format, not an anti-filter bypass. Verified `/blast/image` covers the CID-inline product flow through the existing campaign/delivery engine, including asset lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text fidelity, and an optional ordinary HTTP(S) destination link behind the primary image. Preserve safe formats, bounded size/file counts, meaningful alt/plain-text alternatives, provider MIME compatibility, and preview of the actual structure.

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
- verified experiment run-wide concurrency binding;
- verified experiment smooth-pacing binding;
- verified experiment bounded-burst pacing binding;
- published explicit transport-encoding + UTF-8 binding at `09234cf551897598365936a4fe5b214b6852b0fd`, merged-main Quality #202 green.

### Current partially implemented / requires proof

- `contentMode` is metadata-only; begin with the bounded `cid-inline` slice above;
- remaining content modes require separate owner-level reconciliation and proof;
- provider adaptive slowdown state is consumed by the dispatcher and temporary/rate-limit cooldown is enforced, but the complete pressure → slowdown → gradual-recovery loop and restart durability still need focused end-to-end proof;
- eligible-provider failover exists, while dedicated proof must distinguish temporary-unavailability failover from policy-block fail-closed behavior;
- remaining effective experiment values must record applied values/derived state so runs are reproducible;
- privacy/retention controls and final experiment Activity/UX/export polish remain incomplete.

### Remaining major milestones

- bind `cid-inline` red-first and publish it through exact-head + merged-main Quality;
- reconcile remaining content modes only where deterministic existing owners exist;
- finish remaining reproducibility/effective-value evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider pressure/slowdown/recovery telemetry and restart-durability proof;
- add privacy/retention controls for experiment evidence/message snapshots;
- finish experiment Activity/UX for configuration, live evidence, stop/review, and export;
- maintain CI/security/tenant/race coverage for every new mutation path;
- complete final production hardening and VPS reconciliation only after repository Quality is green.

## Non-negotiable experiment boundary

Experiments may vary behavior only **inside** the authorized envelope; they may never expand it. Recipient allowlists, authorization metadata, provider/sender scope, configured production ceilings, suppression rules, complaint/bounce brakes, policy-block state, hard time/volume limits, and kill switch remain authoritative regardless of profile. Experimental behavior must never silently route around provider enforcement.

## Engineering rule

Do not implement this addendum as one monolithic change. Reconcile each slice against repository truth, preserve existing owners, add focused tests first, keep tenant/sender-domain boundaries explicit, run the full Quality pipeline, and merge narrow verified increments before moving to the next dependency.
