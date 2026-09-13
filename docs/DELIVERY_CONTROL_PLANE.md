# Delivery Control Plane & Authorized Resilience Experiments

This document is the canonical product/engineering addendum for EmailSystem's adaptive multi-provider delivery control plane and its authorized resilience-testing capabilities. It exists so these requirements are not lost between implementation slices.

## Product intent

EmailSystem is not just a queue that hands an entire recipient list to providers as fast as possible. The delivery engine must absorb large campaigns quickly, then release actual transport attempts at a controlled, observable, tenant-safe pace.

The same application may also run explicitly authorized resilience experiments. Those experiments share the production delivery engine and provider integrations; they are not a second product or a separate sender. Experiment behavior must be explicitly scoped, observable, bounded, and auditable.

A provider policy/enforcement block remains a distinct fail-closed state in normal delivery. The system must not silently turn provider failover into enforcement circumvention.

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
- Queueing thousands of recipients is allowed; queue discovery speed must remain separate from transport-start speed.

### Adaptive pacing and backoff

- Track an effective rate separately from configured ceilings.
- Provider `429`, `Retry-After`, transient failures, deferrals, connection pressure, and recent unhealthy outcomes may reduce effective pace or create cooldowns.
- Healthy history may recover pace gradually; adaptation must never increase throughput above configured limits.
- Prefer conservative congestion-style behavior: reduce quickly under pressure, recover gradually.
- Persist or derive adaptation from durable attempt history where possible so a worker restart does not erase pressure evidence.
- Compute/record `nextAllowedAt`-style pacing decisions rather than repeatedly hot-looping ineligible jobs.

### Warm-up / soft start

- Support configurable profiles such as Conservative, Balanced, and High-capacity-within-policy.
- Warm-up is scoped at least to tenant + sender domain, not independently per provider.
- A newly active/high-rate sender domain should ramp toward its configured ceiling rather than begin with an immediate high burst.
- Long enough inactivity should return the domain to an appropriate soft-start state.
- Warm-up profiles must be explicit, inspectable, and unable to exceed configured limits.

### Feedback brakes

Inputs should include, where available:

- provider acceptance/rejection categories;
- `429`/rate-limit responses and retry hints;
- temporary SMTP/API errors and deferrals;
- hard/soft bounce rates;
- complaints and unsubscribes;
- authenticated provider delivery events;
- provider health/quota state;
- campaign/account safety state.

The resulting action should be explicit: continue, slow down, cool down, temporarily remove provider, pause campaign, pause account, or require review.

### Truthful delivery state

- Provider/API/SMTP acceptance is not mailbox delivery.
- Generic SMTP acceptance remains delivery-unconfirmed unless an authoritative downstream signal exists.
- Authenticated provider events or another authoritative delivery signal may move the durable state to `DELIVERED`.
- Open/click tracking must never be used as delivery confirmation.

## Activity and observability

Activity should make the control plane understandable without exposing secrets or recipient data unnecessarily.

Show, where evidence exists:

- intended recipients and completed/remaining recipients;
- observed messages/minute from actual transport starts;
- estimated remaining time only while recent activity is sufficient to support it;
- active/eligible provider count;
- provider cooldown/pressure state;
- configured ceiling versus current effective pace;
- warm-up profile/stage;
- safety waits and policy-review states;
- last meaningful pacing decision and reason.

Never invent an ETA when dispatch is idle or evidence is stale.

## Authorized resilience experiment mode

Authorized experiments live inside EmailSystem and reuse the same core delivery engine. They are represented as an explicit run/profile type so their intent, scope, and evidence are distinguishable from ordinary campaigns.

### Scope metadata

Each experiment should record:

- authorization/reference metadata supplied by the operator;
- tenant/account, provider connections, sender identities/domains, and controlled recipients included in scope;
- start/end window;
- maximum recipient count / transport attempts / duration;
- allowed experiment variables;
- stop conditions;
- operator and creation timestamp;
- immutable profile/version identifier.

### Controlled recipients

- Support explicit allowlists for experiment recipients where required by the engagement.
- Prevent accidental expansion beyond the configured experiment scope.
- Preserve the normal suppression and sender-authorization controls unless the approved test contract specifically changes a benign test parameter.

### Experiment profiles

Profiles may vary legitimate transport and delivery parameters such as:

- pacing interval / effective rate within configured ceilings;
- burst versus smooth pacing profiles;
- provider selection/rotation weights;
- concurrency within configured ceilings;
- retry timing and cooldown behavior;
- provider-specific transport configuration;
- standards-compliant MIME transfer encoding and charset choices;
- HTML/text/image-first content mode;
- attachment versus inline-image transport;
- other documented provider-supported settings.

These experiments measure whether provider behavior is consistent and resilient. They must not automatically conceal messages from the transmitting provider or silently route around a provider's policy block.

### Stop conditions and kill switch

- Every experiment has hard volume/time ceilings.
- A global/admin kill switch must stop new experiment transport starts.
- Provider policy/enforcement responses are always captured as evidence.
- Normal behavior is fail-closed on a policy block.
- Any authorized continuation after an enforcement response must remain explicit, scoped, auditable, and limited to the approved non-evasive test procedure rather than automatic rerouting around the control.

## Evidence capture

For each experiment and relevant pacing decision, persist enough safe evidence to reproduce the observation without leaking secrets.

Capture at minimum:

- experiment/profile/version ID;
- provider connection ID/name/type/transport (never credentials);
- tenant and sender-domain identifiers using safe IDs/hashes where appropriate;
- campaign/delivery/attempt IDs;
- timestamps;
- configured provider/domain/campaign ceilings;
- effective rate and pacing gap at the time;
- provider pressure/cooldown state;
- response category and safe/redacted provider response details;
- retry hint / retry-after where available;
- durable delivery state before/after;
- policy/health state transition;
- experiment stop reason;
- reproducibility notes / outcome classification.

Evidence/audit records should be append-only or otherwise tamper-evident at the application level.

## Privacy and platform-internal obfuscation

The legitimate privacy goal is to minimize sensitive information inside EmailSystem itself, not to hide a message from the provider that must transmit it.

Required direction:

- keep provider credentials encrypted at rest and excluded from normal API/log output;
- mask or hash recipient identifiers in operational/experiment logs where full addresses are unnecessary;
- redact provider responses before persistence/display;
- avoid long-term message-body retention when not required for campaign operation or evidence;
- add explicit retention controls for experiment evidence and message snapshots;
- use safe identifiers/hashes in audit/event streams where practical;
- keep secrets out of Git, CI artifacts, screenshots, and support references.

## Standards-compliant encoding

EmailSystem should support normal email/MIME compatibility rather than ad-hoc content hiding:

- UTF-8/charset normalization;
- quoted-printable where appropriate;
- base64 transfer encoding where appropriate for binary content;
- correct MIME boundaries/content types;
- attachment encoding;
- inline-image/CID handling;
- `multipart/alternative` and `multipart/related` structures where appropriate;
- deterministic HTML/text rendering and transport compatibility tests.

Encoding choices used by an experiment must be captured in its evidence so results are reproducible.

## Image-first message mode

Image-first sending is a supported content-format requirement, not an anti-filter bypass mechanism.

Supported product shapes should include:

1. **Inline image (CID)** — a minimal HTML/MIME wrapper references an embedded image using `multipart/related`.
2. **Hosted image** — HTML contains a normal image URL with dimensions/alt text and optional ordinary destination link.
3. **Attachment-only image** — the photo is a standard MIME attachment and the body contains a small text/HTML explanation.
4. **Image-dominant template** — a large visual is the primary presentation while a real text alternative remains available.

Important implementation requirements:

- permit common safe formats (for example PNG/JPEG/WebP only where client/provider compatibility is proven);
- enforce bounded dimensions and encoded size;
- preserve or generate meaningful `alt` text and a plain-text alternative;
- record whether the image was hosted, CID-inline, or attached;
- ensure provider adapters preserve the requested MIME structure consistently;
- preview the actual message structure before sending;
- include image mode in experiment evidence/compatibility results.

An email cannot universally use a photo as a body without MIME structure: attachment-only is possible, while an inline visual normally still requires a minimal MIME/HTML wrapper. Some clients also block remote images by default, so image-only campaigns can be less accessible and less reliable than a normal HTML/text message. EmailSystem should make those tradeoffs visible rather than disguising them.

## Implementation status

### Verified/merged foundation

- weighted/fair multi-provider dispatcher;
- provider-specific rate/quota grouping;
- provider-independent sender-domain smooth pacing;
- adaptive slowdown/cooldown from recent provider pressure;
- truthful recipient/provider-acceptance versus delivery presentation;
- observed campaign pacing/ETA telemetry based on real transport starts;
- existing safety budgets, complaint/bounce brakes, suppression handling, sender authorization, provider policy-block state.

### In-flight

- bounded high-rate sender-domain soft start after inactivity.

### Remaining major milestones

- configurable warm-up profiles and explicit domain/campaign/account pacing policy;
- richer `Retry-After` / cooldown scheduling and next-allowed visibility;
- provider health/effective-rate telemetry;
- first-class experiment run/profile model and scope enforcement;
- immutable/tamper-evident experiment evidence and audit trail;
- experiment kill switch and hard time/volume ceilings;
- configurable controlled-recipient allowlists;
- MIME/encoding compatibility experiment profiles;
- image-first/CID/attachment content mode;
- privacy/retention controls for evidence and message snapshots;
- final Activity/UX for experiment configuration, live evidence, and export;
- end-to-end CI/security/tenant/race coverage for every new mutation path.

## Engineering rule

Do not implement this addendum as one monolithic change. Reconcile each slice against the current repository, preserve existing owners, add focused tests first, keep tenant and sender-domain boundaries explicit, run the full quality pipeline, and merge narrow verified increments before moving to the next dependency.
