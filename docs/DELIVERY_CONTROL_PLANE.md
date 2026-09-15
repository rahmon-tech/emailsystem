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

PR #41 merged at `09234cf551897598365936a4fe5b214b6852b0fd`. Exact-head Quality #201 and merged-main Quality #202 passed fully; documentation checkpoint `a78414484f9e93a5ea334227b99a7187fa98f49a` passed Quality #203.

- `transportEncoding` supports `provider-default`, `quoted-printable`, and `base64`; `charset` remains standards-compliant UTF-8.
- An explicit non-default encoding is allowed only on transports that deterministically own raw MIME: SMTP and SES raw MIME.
- API-body provider scopes fail closed at experiment-profile creation for explicit non-default encoding.
- The approved explicit encoding/charset is written into the existing immutable campaign message snapshot and reaches the existing `deliveryMessage()` / `ProviderMessage` path without a second renderer or sender.
- SMTP applies the existing Nodemailer encoding option; SES applies the existing MailComposer raw-MIME path.
- `transport.started` evidence records requested encoding, effective explicit encoding (or null for provider-default), and UTF-8 charset.
- Ordinary provider-default sending, production pacing, quotas, concurrency, suppression, policy blocks, hard experiment ceilings, and kill switch remain authoritative.
- No schema/migration, second delivery engine, second MIME stack, worker replacement, live recipient, or external provider was introduced.

### Published CID-inline content-mode contract — PR #42

PR #42 merged at `9c4b8d52c08980ded11434f352de3e1eb643e33f`. Final exact-head Quality #207 and merged-main Quality #208 passed fully; documentation checkpoint `99d679262c58cedeb130dd668319bb97d4a4a9dd` passed Quality #209.

- `contentMode: "cid-inline"` requires every scoped provider transport to support inline CID attachments; incompatible scopes fail closed at experiment-profile creation.
- A campaign bound to a CID-inline experiment must contain at least one real inline attachment with a safe Content-ID referenced by campaign HTML before campaign mutation/preflight proceeds.
- Existing campaign preflight remains authoritative for CID reference matching, provider eligibility, attachment bounds, sender authorization, suppressions, tracking/reputation, safety, and readiness.
- Successful `transport.started` evidence reports `requestedMode: "cid-inline"` and `effectiveMode: "cid-inline"` only when the stored immutable campaign snapshot actually proves the CID-inline structure; otherwise effective mode remains null rather than claiming application.
- The binding reuses existing campaign/Image-first/CID/provider-capability and evidence owners. It adds no experiment-only renderer or conversion.
- All ordinary production pacing/rate/quota/concurrency, sender/recipient scope, suppression, policy, hard experiment ceilings, and kill-switch controls remain authoritative.
- No schema/migration, second delivery engine, provider adapter, second MIME stack, worker replacement, live recipient, or external provider was introduced.

### Published HTML content evidence contract — PR #43

PR #43 merged at `df1669e21b8af95ed0afe8c8894d61d04a9ce5d1`. Exact head `42fe527bd7ca9a3d177fc1aeaa12de070552657f` passed final Quality #215 and merged-main Quality #218 passed fully.

- The slice does not create an HTML-only transport or alter rendering; it binds experiment reproducibility evidence to the existing ordinary production message structure.
- Test-only `fe8b5413fdda553c638fa689ebbc557b91f2cf6e` / Quality #210 produced the intended integration red.
- Implementation `a65772e733eb967b3d667a5bfb86a37a656cea75` / Quality #211 passed fully.
- `contentMode: "html"` may be reported effective only when the immutable campaign snapshot contains both non-empty HTML and its non-empty plain-text alternative.
- `transport.started` then records `{ requestedMode: "html", effectiveMode: "html" }`; otherwise effective mode is null/not claimed.
- `text`, `hosted-image`, `attachment-only`, and `image-dominant` remain metadata-only.
- No schema/migration, content transformation, renderer, provider adapter, MIME stack, worker, sender, live recipient, or external-provider behavior is added.

### Published run-start reproducibility evidence contract — PR #46

PR #46 merged at `7930c6b07302af2b955784d45a40ed32b4e18321`. Exact implementation head `5453f013515ed0a2e1279676426e416a5541d8aa` passed Quality #221 and merged-main Quality #222 passed fully.

- Test-only `e93770e05e2dc116ef223b9d522d47feae6b0ee7` / Quality #220 produced the intended integration red while the preceding gates stayed green.
- A successful `READY → RUNNING` state transition and the first `run.started` chained evidence entry are committed in the same database transaction.
- `run.started` records the authorization reference, profile version, hard recipient/attempt/duration ceilings, approved start, actual start and expiry, normalized experiment variables, and sorted provider/sender scope IDs.
- Controlled recipients are represented in the evidence snapshot only by run-scoped hashes; raw controlled-recipient addresses are not persisted there.
- Existing kill-switch, experiment-window, provider-policy, enabled-provider, and enabled-sender checks remain authoritative before start.
- This snapshot proves the approved run envelope at start time; it does not convert metadata-only variables into claimed effective runtime behavior.
- No schema/migration, renderer, provider adapter, worker, campaign message path, live recipient, external provider, or new transport behavior was introduced.

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

- run start: authorization reference, profile version, hard limits, approved/actual time window, normalized variables, sorted provider/sender scopes, and run-scoped controlled-recipient hashes without raw controlled-recipient addresses;
- smooth pacing: profile, configured interval, effective minimum interval;
- bounded burst: profile, configured window, burst size, occupancy before/after an admitted start;
- explicit transport encoding: requested encoding, deterministic effective encoding where applicable, UTF-8 charset;
- CID-inline content mode: requested mode plus effective mode only when the immutable stored campaign structure proves the CID reference and matching inline attachment;
- HTML content mode: requested/effective `html` only when the immutable snapshot proves the existing HTML + plain-text-alternative structure.

Additional experiment values must record effective applied values/derived state only when runtime proof exists; do not report metadata-only variables as effective behavior.

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

Experiment `contentMode` values are `html`, `text`, `cid-inline`, `hosted-image`, `attachment-only`, and `image-dominant`, but schema acceptance alone never proves runtime behavior. Each mode must map only to structures already owned by existing campaign/renderer/provider paths.

### Published first slice — `cid-inline`

`cid-inline` is published through PR #42 and merged-main Quality #208. It is runtime-bound because campaign attachment validation, CID reference matching, provider capability filtering, Image-first structure, and supported transport semantics already existed and could be reused without a new renderer or conversion path.

### Published second slice — `html`

PR #43 publishes evidence binding for the existing ordinary HTML message structure; merged-main Quality #218 passed fully. It does not introduce HTML-only sending. Effective `html` evidence requires the stored immutable message to contain non-empty HTML plus its non-empty plain-text alternative.

Do not treat the remaining modes as implemented. In particular, do not pretend `text` is already text-only: `ProviderMessage` currently carries both HTML and text and API adapters ordinarily send both. Likewise do not fabricate hosted-image, attachment-only, or image-dominant transformations. If no deterministic owner exists without redesign, advance to the next control-plane dependency rather than inventing semantics.

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
- published explicit transport-encoding + UTF-8 binding at `09234cf551897598365936a4fe5b214b6852b0fd`, merged-main Quality #202 green, with documentation checkpoint `a78414484f9e93a5ea334227b99a7187fa98f49a` / Quality #203 green;
- published CID-inline content-mode binding at `9c4b8d52c08980ded11434f352de3e1eb643e33f`, merged-main Quality #208 green, with documentation checkpoint `99d679262c58cedeb130dd668319bb97d4a4a9dd` / Quality #209 green;
- published HTML content-evidence binding at `df1669e21b8af95ed0afe8c8894d61d04a9ce5d1`, exact-head Quality #215 green and merged-main Quality #218 green;
- published run-start approved-envelope reproducibility evidence at `7930c6b07302af2b955784d45a40ed32b4e18321`, exact-head Quality #221 green and merged-main Quality #222 green.

### Current partially implemented / requires proof

- `text`, `hosted-image`, `attachment-only`, and `image-dominant` remain metadata-only and require separate owner-level reconciliation before any implementation;
- provider adaptive slowdown state is consumed by the dispatcher and temporary/rate-limit cooldown is enforced, but the complete pressure → slowdown → gradual-recovery loop and restart durability still need focused end-to-end proof;
- eligible-provider failover exists, while dedicated proof must distinguish temporary-unavailability failover from policy-block fail-closed behavior;
- additional effective experiment values may be recorded only where runtime proof exists; the published run-start snapshot proves the approved envelope rather than metadata-only application;
- privacy/retention controls and final experiment Activity/UX/export polish remain incomplete.

### Remaining major milestones

- bind no further content mode unless repository truth proves a deterministic existing owner without redesign;
- add explicit temporary-failover-versus-policy-stop proof next;
- finish provider pressure/slowdown/recovery telemetry and restart-durability proof;
- add privacy/retention controls for experiment evidence/message snapshots;
- finish experiment Activity/UX for configuration, live evidence, stop/review, and export;
- maintain CI/security/tenant/race coverage for every new mutation path;
- complete final production hardening and VPS reconciliation only after repository Quality is green.

## Non-negotiable experiment boundary

Experiments may vary behavior only **inside** the authorized envelope; they may never expand it. Recipient allowlists, authorization metadata, provider/sender scope, configured production ceilings, suppression rules, complaint/bounce brakes, policy-block state, hard time/volume limits, and kill switch remain authoritative regardless of profile. Experimental behavior must never silently route around provider enforcement.

## Engineering rule

Do not implement this addendum as one monolithic change. Reconcile each slice against repository truth, preserve existing owners, add focused tests first, keep tenant/sender-domain boundaries explicit, run the full Quality pipeline, and merge narrow verified increments before moving to the next dependency.