# Current work

## Verified baseline

Remote `main` is verified at `09234cf551897598365936a4fe5b214b6852b0fd` (`feat(experiment): bind explicit transport encoding`, PR #41). Full merged-main Quality #202 passed for that exact SHA, including fresh migrations, schema/drift and upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

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

PR #41 is published at `09234cf551897598365936a4fe5b214b6852b0fd`; exact-head Quality #201 and merged-main Quality #202 both passed fully.

Canonical evidence:

- verified parent `631150eb97d12d42e805699b6d752494b6f2ba8c` passed Quality #192;
- `c8ac5c14734e8a0e8acf8755f833863e2b73b7f8` / Quality #193 proved `ProviderMessage` could not express explicit encoding;
- `537b8f2297dd383e64e78c968469cc727b26539a` / Quality #194 established the provider-message contract and advanced to provider-behavior red;
- `804ab399c30911253c722761c824e2db8336b4a9` bound explicit encoding to the existing SMTP/Nodemailer and SES/MailComposer raw-MIME owners and made API-body transports fail closed; Quality #195 passed fully;
- `bdcc75dc9ae2d3a18da1e31a176112403e2d92ff` / Quality #196 exposed a fixture issue plus the runtime gap and is not the canonical runtime red;
- `0f5a69c7cd7b07d225731b1b6754b5ab0adabcc0` / Quality #197 produced the clean runtime red;
- `a2cca56de67aa450d86ef624dd4c1c75270a4014` exposed the shared raw-MIME capability helper; Quality #198 was superseded/cancelled;
- `53dc6f5832e09a4368a93ea7396fed509f653707` made incompatible explicit-encoding scopes fail closed; Quality #199 then left only actual message propagation red (`undefined` versus `base64`);
- `f424afb942aa7b90271f15eab730cd9b6fccafdd` completed campaign-snapshot/runtime/evidence binding; Quality #200 passed fully;
- reconciled exact head `827092c75ab883ee195348b1187de6f618928471` passed Quality #201;
- guarded merge produced `09234cf551897598365936a4fe5b214b6852b0fd` and merged-main Quality #202 passed fully.

Published contract:

- `transportEncoding` supports `provider-default`, `quoted-printable`, and `base64`; `charset` remains UTF-8;
- explicit non-default encoding is permitted only where the existing transport deterministically owns raw MIME: SMTP and SES;
- incompatible API-body provider scopes fail closed at experiment-profile creation;
- the approved explicit encoding/charset is carried by the existing immutable campaign message snapshot → `deliveryMessage()` → `ProviderMessage` path;
- `transport.started` evidence records requested encoding, effective explicit encoding (or null for provider-default), and UTF-8 charset;
- no schema/migration, second renderer/MIME stack, worker, live recipient, or external-provider delivery was introduced.

## Current milestone — content-mode binding

`contentMode` remains metadata-only. Repository reconciliation shows the smallest deterministic first slice is `cid-inline`, because the existing campaign/Image-first/provider architecture already owns every required representation and safety check:

- campaign attachment input already distinguishes `inline` from ordinary `attachment`, requires a safe Content-ID for inline assets, forbids Content-ID on ordinary attachments, and rejects duplicate inline IDs;
- existing preflight already checks HTML `cid:` references against inline attachments in both directions;
- existing provider eligibility already filters inline-CID campaigns through `supportsInlineAttachmentTransport`;
- `/blast/image` already emits HTML containing a `cid:<contentId>` image plus the matching inline attachment;
- supported SMTP/SES/API adapters already preserve verified CID semantics.

### First bounded slice — `cid-inline`

Proceed red-first with this contract only:

- `contentMode: "cid-inline"` requires every scoped provider to support inline CID attachments; incompatible scopes fail closed before campaign mutation;
- a campaign bound to a `cid-inline` experiment must contain at least one real inline attachment with a safe Content-ID referenced by the campaign HTML;
- reuse the existing campaign preflight for reference matching, provider filtering, attachment bounds, suppressions, sender authorization, tracking/reputation, and safety checks rather than duplicating them;
- successful `transport.started` evidence records requested mode and effective mode only when the stored campaign snapshot actually proves the CID-inline structure;
- `html`, `text`, `hosted-image`, `attachment-only`, and `image-dominant` remain metadata-only until separately reconciled and bound; do not falsely report them as effective;
- preserve recipient allowlists, provider/sender scope, pacing/rate/quota/concurrency ceilings, suppression, policy enforcement, hard experiment limits, and kill switch;
- use controlled recipients and injected/mock/local transports only; no live recipient or external provider without explicit authorization.

Do not start with `text`: the current provider message contract requires both HTML and text and the API adapters normally emit both, so text-only semantics need a separate owner-level reconciliation. Do not invent hosted-image, attachment-only, or image-dominant transformations.

## Delivery-control-plane follow-on

After the bounded `cid-inline` slice is published, continue from repository truth in dependency order:

- reconcile and bind only those remaining content modes with deterministic existing owners;
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
