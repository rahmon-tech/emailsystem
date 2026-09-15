# Current work

## Verified baseline

Remote `main` is published at PR #43 merge `df1669e21b8af95ed0afe8c8894d61d04a9ce5d1`, whose merged-main Quality #218 passed fully. The exact PR head `42fe527bd7ca9a3d177fc1aeaa12de070552657f` passed final exact-head Quality #215 before the guarded merge. The prior documentation checkpoint `99d679262c58cedeb130dd668319bb97d4a4a9dd` / Quality #209 remains the verified parent baseline from which PR #43 was developed.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, test-send path, renderer, or MIME stack.

## Completed product foundation

The verified system on `main` includes:

- the primary Providers → Blast → Activity product shell;
- provider configuration/verification, encrypted credentials, sender authorization, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation, and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- verified experiment run-wide concurrency, smooth-pacing, bounded-burst, CID-inline content-mode, and HTML-content evidence bindings;
- standards-compliant explicit experiment transfer-encoding binding for SMTP/SES raw MIME with UTF-8 charset and fail-closed incompatible provider scopes;
- inline-vs-attachment provider message semantics and Content-ID support across supported SMTP/API transports, with fail-closed behavior for unsupported inline transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the optional primary-image HTTP(S) destination link.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Published experiment control milestones

### Smooth pacing — PR #39

PR #39 merged at `c797f5732e7a513f1b646b7458cc42a5929b62e2`; merged-main Quality #184 passed and documentation checkpoint `e3eb700b213484dba3f195ea2dbdaacc22366b0d` passed Quality #185. Positive experiment `pacingIntervalMs` is an additional run-wide minimum transport-start gap; production provider/rate-group/sender-domain/account/campaign/warm-up/adaptive/quota/suppression/policy/safety controls remain independently authoritative.

### Bounded-burst pacing — PR #40

PR #40 merged at `8e80c4ff6077726291deed0dab6ed935c2c4d460`; merged-main Quality #191 passed and documentation checkpoint `631150eb97d12d42e805699b6d752494b6f2ba8c` passed Quality #192. `pacingIntervalMs` is the run-wide burst window; `pacingBurstSize` is the maximum starts admitted in that window. Full windows use existing campaign safety-wait state without consuming an experiment attempt.

### Explicit transport encoding + UTF-8 — PR #41

PR #41 is published at `09234cf551897598365936a4fe5b214b6852b0fd`; exact-head Quality #201 and merged-main Quality #202 passed fully. Documentation checkpoint `a78414484f9e93a5ea334227b99a7187fa98f49a` passed Quality #203.

Published contract:

- `transportEncoding` supports `provider-default`, `quoted-printable`, and `base64`; `charset` remains UTF-8;
- explicit non-default encoding is permitted only where the existing transport deterministically owns raw MIME: SMTP and SES;
- incompatible API-body provider scopes fail closed at experiment-profile creation;
- the approved explicit encoding/charset is carried by the existing immutable campaign message snapshot → `deliveryMessage()` → `ProviderMessage` path;
- `transport.started` evidence records requested encoding, effective explicit encoding (or null for provider-default), and UTF-8 charset;
- no schema/migration, second renderer/MIME stack, worker, live recipient, or external-provider delivery was introduced.

### CID-inline content mode — PR #42

PR #42 is published at `9c4b8d52c08980ded11434f352de3e1eb643e33f`; final exact-head Quality #207 and merged-main Quality #208 passed fully. Post-merge documentation checkpoint `99d679262c58cedeb130dd668319bb97d4a4a9dd` passed Quality #209.

Published contract:

- `contentMode: "cid-inline"` requires every scoped provider to support inline CID attachments; incompatible scopes fail closed at experiment-profile creation;
- a campaign bound to a CID-inline experiment must contain at least one real inline attachment with a safe Content-ID referenced by campaign HTML before campaign mutation/preflight proceeds;
- existing campaign preflight remains authoritative for CID matching, provider eligibility, attachment bounds, sender authorization, suppressions, tracking/reputation, safety, and readiness;
- successful `transport.started` evidence records `{ requestedMode: "cid-inline", effectiveMode: "cid-inline" }` only when the immutable stored campaign snapshot proves the structure;
- no schema/migration, second renderer/MIME stack, provider adapter, worker replacement, live recipient, or external provider was introduced.

### HTML content evidence — PR #43

PR #43 is published at `df1669e21b8af95ed0afe8c8894d61d04a9ce5d1`. Its exact head `42fe527bd7ca9a3d177fc1aeaa12de070552657f` passed final Quality #215, and merged-main Quality #218 passed fully.

TDD evidence:

- test-only `fe8b5413fdda553c638fa689ebbc557b91f2cf6e` / Quality #210 produced the intended integration red after earlier gates passed;
- implementation `a65772e733eb967b3d667a5bfb86a37a656cea75` / Quality #211 passed the full Quality pipeline;
- the implementation changes only the experiment evidence owner and preserves the existing campaign/provider message path.

Published contract:

- `contentMode: "html"` maps to the existing ordinary production message structure: non-empty stored HTML plus a non-empty plain-text alternative;
- `transport.started` may report `{ requestedMode: "html", effectiveMode: "html" }` only when the immutable campaign snapshot proves both components;
- no content transformation, renderer change, provider adapter change, MIME change, campaign schema change, worker change, or new sender path is introduced;
- `text`, `hosted-image`, `attachment-only`, and `image-dominant` remain metadata-only and must not be reported as effective behavior.

## Delivery-control-plane follow-on

With PR #43 published, continue from repository truth in dependency order:

- do not fabricate semantics for `text`, `hosted-image`, `attachment-only`, or `image-dominant`; bind another content mode only if a deterministic existing owner is proven without redesign;
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
