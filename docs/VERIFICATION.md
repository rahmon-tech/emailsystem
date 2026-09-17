# Implementation and verification report

This report separates repository/CI evidence from provider-account evidence and deployment-host evidence. A green CI run does not prove live provider credentials, inbox placement, DNS/TLS/webhook reachability or VPS installation.

## Published assembled checkpoint

Published `main` is exactly:

`5ea40e51cbbc7848b02c3945d064e0c7e86ce580`

The former #78 → #79 → #82 → #83 → #84 stack was published by non-forced fast-forward from `ce87caa214f60247cb06a0089dcd405ed719b855`. Commit comparison was ahead-only, so the already-verified implementation ancestry was preserved.

Quality #345 / run `35284283698` was triggered by the `main` publication push and passed completely on that exact SHA.

It passed:

- locked dependency installation;
- high/critical production dependency audit;
- Prisma generation;
- fresh PostgreSQL migrations;
- migration/schema drift verification;
- upgrade rehearsal;
- lint;
- repository secret scan;
- strict TypeScript;
- unit tests;
- PostgreSQL/Redis integration tests;
- production Next.js build;
- Playwright Chromium/browser E2E;
- screenshot/visual review emission;
- production-container validation;
- diagnostics/artifact handling and teardown.

This is the final repository/CI development acceptance checkpoint for the assembled published state.

## Published milestone history

The final Activity/evidence/documentation slices are now contained in `main`:

### PR #78 — experiment configuration and operator control

Exact head: `e135ad5a196d5a67d65b8d475f53eef2e4f4da48`

Quality #319 / run `35239476640` passed fully.

### PR #79 — minimized Activity evidence review

Exact head: `0cd6e8ac24901cff948e88015d41b0fcc3a993ef`

Quality #320 passed fully.

### PR #82 — canonical checkpoint reconciliation

Exact head: `c4fc22e56f906ab4f8811ace783a77ee8d16d0fd`

Quality #328 / run `35264063476` passed fully.

### PR #83 — bounded Activity evidence verification

Exact head: `93e35f5125d3ec212565bc2d6d5b07ffc2aea333`

Quality #342 / run `35267311307` passed fully.

The normal 10-second Activity evidence refresh uses bounded/index-supported summary reads and does not take the experiment transport/control lock. Authoritative full-chain verification is operator-explicit. Tenant/privacy/tamper proof remains intact, and campaign-keyed state prevents stale overlapping verification responses from contaminating another campaign.

### PR #84 — final pre-publication canonical documentation reconciliation

Exact head: `5ea40e51cbbc7848b02c3945d064e0c7e86ce580`

Quality #344 / run `35280902536` passed fully before publication. The same exact commit is now published `main`, and push-triggered Quality #345 passed fully afterward.

## Verified product boundaries

The repository has CI proof for:

- tenant-scoped provider credentials/configuration models, sender identities and provider-domain authorization logic;
- imports, immutable campaign snapshots, scheduling, campaign preparation and background dispatch;
- weighted/fair provider selection plus provider quotas/rates/concurrency and shared account/domain/campaign ceilings;
- warm-up profiles, adaptive slowdown, durable pressure reconstruction and gradual recovery;
- provider `Retry-After` parsing, delivery retry timing, provider cooldown and Activity `nextAllowedAt` visibility;
- fail-closed provider policy/enforcement handling;
- suppression/unsubscribe and complaint/hard-bounce safety brakes;
- truthful provider acceptance versus downstream-delivery state;
- tracking/privacy/reputation controls and structured redacted observability;
- ordinary HTML/text + attachment/CID semantics and Image-first behavior through the existing message path;
- authorized experiment profiles/runs, bounded scope/windows/usage, kill switch and transport-start checks;
- run-wide experiment concurrency, smooth pacing and bounded-burst pacing;
- explicit UTF-8/transfer-encoding controls where deterministic raw-MIME ownership exists;
- deterministic `cid-inline` runtime binding and deterministic `html` snapshot evidence;
- run-start reproducibility evidence, temporary failover vs policy-stop proof and SHA-256 evidence export;
- evidence/message retention with whole-ledger purge and sensitive terminal snapshot scrubbing;
- Activity experiment summary/configuration/stop/evidence UX;
- bounded live evidence review plus operator-explicit full-chain verification;
- native bootstrap/preflight, Docker/standalone packaging and the full Quality workflow.

## Intentionally unclaimed behavior

`text`, `hosted-image`, `attachment-only` and `image-dominant` remain experiment metadata only. They are not reported as effective runtime behavior because no separate deterministic existing owner has been proven for those labels without redesigning the message path.

Repository/CI verification also does **not** prove:

- any live provider credential is currently valid;
- a provider account has a particular quota, permission, reputation or production state;
- a sender/domain is currently verified at that provider;
- provider acceptance equals inbox delivery;
- DNS, TLS, webhooks or reverse proxy are reachable in the intended environment;
- PostgreSQL/Redis persistence and backups are correctly installed on the target host;
- web/worker process supervision is correctly configured on the target host;
- a real recipient/provider smoke test has passed.

## Development acceptance boundary

The development/publication acceptance boundary is satisfied by exact published `main` SHA `5ea40e51cbbc7848b02c3945d064e0c7e86ce580` and push-triggered Quality #345 / run `35284283698`.

Further repository feature work should be driven by a new product requirement or a concrete defect, not by the old pre-publication checklist.

## Deployment/provider acceptance boundary

The next phase is environment-specific acceptance.

The complete EmailSystem runtime is self-hosted web + independent worker + PostgreSQL + Redis. Vercel is not the acceptance target for the whole system.

The real environment must verify:

- Node/pnpm or Docker prerequisites;
- PostgreSQL and Redis persistence;
- migrations and restore/rollback procedure;
- web + worker process supervision/restart;
- reverse proxy/TLS/base path;
- production secrets/provider credentials;
- sender/domain authorization;
- authenticated webhook reachability;
- health/readiness;
- logging/monitoring;
- backups/restore;
- provider-account quota/permission reality;
- a small controlled legitimate smoke test.

See `CURRENT_WORK.md`, `DELIVERY_CONTROL_PLANE.md`, `PROVIDERS.md`, `DEPLOYMENT.md`, `ARCHITECTURE.md` and `SECURITY.md` for the governing boundaries.
