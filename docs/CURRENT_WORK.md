# Current work

## Verified baseline

Remote `main` is verified at `a78414484f9e93a5ea334227b99a7187fa98f49a` (`docs: advance verified transport encoding checkpoint`). Quality #203 passed for that exact SHA after published PR #41 / merged-main Quality #202, including fresh migrations, schema/drift and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, test-send path, renderer, or MIME stack.

## Completed product foundation

The verified system on `main` includes:

- the primary Providers → Blast → Activity product shell;
- provider configuration/verification, encrypted credentials, sender authorization, recipient imports, immutable campaign snapshots, pre-flight, background dispatch, tracking, Activity, exports, suppressions/unsubscribe, retry/reconciliation, and delivery safety controls;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- verified experiment run-wide concurrency, smooth-pacing, and bounded-burst bindings;
- standards-compliant explicit experiment transfer-encoding binding for SMTP/SES raw MIME with UTF-8 charset and fail-closed incompatible provider scopes;
- inline-vs-attachment provider message semantics and Content-ID support across supported SMTP/API transports, with fail-closed behavior for unsupported inline transports;
- the authenticated `/blast/image` Image-first composer using the existing campaign/delivery architecture, including primary-image lifecycle, ordinary attachments, test-message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, and the optional primary-image HTTP(S) destination link.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`.

## Published experiment control milestones

### Smooth pacing — PR #39

PR #39 merged at `c797f5732e7a513f1b646b7458cc42a5929b62e2`; merged-main Quality #184 passed and documentation checkpoint `e3eb700b213484dba3f195ea2dbdaacc22366b0d` passed Quality #185. Positive experiment `pacingIntervalMs` is an additional run-wide minimum transport-start gap; production provider/rate-group/sender-domain/account/campaign/warm-up/adaptive/quota/suppression/policy/safety controls remain independently authoritative.

### Bounded-burst pacing — PR #40

PR #40 merged at `8e80c4ff6077726291deed0dab6ed935c2c4d460`; merged-main Quality #191 passed and documentation checkpoint `631150eb97d12d42e805699b6d752494b6f2ba8c` passed Quality #192.

Canonical proof included the model red in Quality #186, runtime red in Quality #187 (`actual 3`, `expected 2`), atomic Redis server-time admission at `1bef0f53b53deaa38eabb11e2b75e6130cf85d38`, direct cross-worker race proof at `9d396319a512591d56ed2f69a283c95b0071c9e1`, candidate Quality #189, reconciled-head Quality #190, and merged-main Quality #191. `pacingIntervalMs` is the run-wide burst window; `pacingBurstSize` is the maximum starts admitted in that window. Full windows use existing campaign safety-wait state without consuming an experiment attempt.

### Explicit transport encoding + UTF-8 — PR #41

PR #41 is published at `09234cf551897598365936a4fe5b214b6852b0fd`; exact-head Quality #201 and merged-main Quality #202 both passed fully. Documentation checkpoint `a78414484f9e93a5ea334227b99a7187fa98f49a` then passed Quality #203.

Published contract:

- `transportEncoding` supports `provider-default`, `quoted-printable`, and `base64`; `charset` remains UTF-8;
- explicit non-default encoding is permitted only where the existing transport deterministically owns raw MIME: SMTP and SES;
- incompatible API-body provider scopes fail closed at experiment-profile creation;
- the approved explicit encoding/charset is carried by the existing immutable campaign message snapshot → `deliveryMessage()` → `ProviderMessage` path;
- `transport.started` evidence records requested encoding, effective explicit encoding (or null for provider-default), and UTF-8 charset;
- no schema/migration, second renderer/MIME stack, worker, live recipient, or external-provider delivery was introduced.

## Current milestone — CID-inline content-mode binding

Draft PR #42, `feat(experiment): bind cid inline content mode`, is now a verified candidate on top of exact verified parent `a78414484f9e93a5ea334227b99a7187fa98f49a`.

Canonical TDD/Quality evidence:

- test-only commit `b8013f5f7f96c7ac759f3a105cad8c293f364194` produced Quality #204 with every gate through unit green and exactly three intended PostgreSQL/Redis integration failures: incompatible provider scope was not rejected, missing CID-inline structure was not rejected before campaign mutation, and effective content-mode evidence was absent;
- implementation commit `2da16fb8fb90e8ac63826ffd47ec0285f7b8ffc1` binds the existing owners only: provider inline-capability validation, experiment campaign/preflight CID structure validation, and tamper-evident `transport.started` content evidence;
- full Quality #205 passed on exact `2da16fb8fb90e8ac63826ffd47ec0285f7b8ffc1`, including migrations/drift/upgrade, lint, secrets, strict TypeScript, unit, PostgreSQL/Redis integration, production build, Playwright E2E, screenshots, production-container validation, diagnostics/artifacts, cleanup, and shutdown.

Verified candidate contract:

- `contentMode: "cid-inline"` requires every scoped provider to support inline CID attachments; incompatible scopes fail closed before campaign mutation;
- a campaign bound to a `cid-inline` experiment must contain at least one real inline attachment with a safe Content-ID referenced by campaign HTML;
- existing campaign preflight remains authoritative for CID reference matching, provider filtering, attachment bounds, sender authorization, suppressions, tracking/reputation, safety, and readiness;
- successful `transport.started` evidence records `{ requestedMode: "cid-inline", effectiveMode: "cid-inline" }` only when the stored campaign snapshot actually proves the CID-inline structure;
- no schema/migration, second renderer/MIME stack, provider adapter, worker, live recipient, or external-provider delivery was introduced.

PR #42 is not published until the reconciled exact head passes fresh Quality, the PR is guarded-merged against its exact head while `main` remains the expected verified parent, and merged-main Quality passes on the resulting SHA.

`html`, `text`, `hosted-image`, `attachment-only`, and `image-dominant` remain metadata-only in this candidate and must not be reported as effective behavior.

## Delivery-control-plane follow-on

After PR #42 publication, continue from repository truth in dependency order:

- reconcile the remaining content modes against actual existing message/renderer/provider owners before choosing the next bounded slice; do not assume schema acceptance means runtime support;
- do not start with `text` unless owner-level reconciliation resolves the current requirement that `ProviderMessage` carries both HTML and text and API adapters ordinarily send both;
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
