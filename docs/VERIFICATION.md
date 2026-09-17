# Implementation and verification report

This report separates repository/CI evidence from provider-account evidence and deployment-host evidence. A green CI run does not prove a live provider account, inbox placement, DNS/TLS reachability or VPS installation.

## Published baseline

Published `main` is PR #72 merge `ce87caa214f60247cb06a0089dcd405ed719b855`.

The exact PR #72 feature head `f6942f6e991b5e15a40485b1b6a441315a22b8e2` passed full Quality #313 before merge. The published baseline includes the established Providers → Blast / Image-first → Activity workflow, provider/sender controls, background worker delivery, pacing/safety, tracking, authorized experiments, evidence/retention, observability and production packaging.

## Verified draft stack

Deployment is intentionally deferred. The following development checkpoints are verified but remain draft/unmerged:

### PR #78 — experiment configuration and operator control

Exact head: `e135ad5a196d5a67d65b8d475f53eef2e4f4da48`

Quality #319 / run `35239476640` passed the complete repository pipeline:

- production dependency audit;
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
- Playwright browser E2E;
- screenshot/visual review emission;
- production-container validation;
- diagnostics/artifact collection and teardown.

The slice exposes normalized approved experiment configuration in Activity and adds operator stop/review through the existing tenant-scoped experiment-run mutation owner. No schema, provider adapter, renderer/MIME, dispatcher/worker, pacing or transport semantics changed.

### PR #79 — minimized live evidence review

Exact head: `0cd6e8ac24901cff948e88015d41b0fcc3a993ef`

Quality #320 passed the complete repository pipeline.

The slice reuses the authoritative tamper-evident evidence verifier server-side and exposes only retention state, integrity state/count/head and recent evidence event names/timestamps. Evidence payloads, recipient hashes, attempt/provider identifiers, message identifiers and sender data are intentionally excluded from the Activity response. Tenant-isolation integration proof and browser live-refresh proof are included.

## Verified product boundaries

The system currently has repository proof for:

- tenant-scoped provider credentials, sender identities and provider-domain authorization;
- imports, immutable campaign snapshots, scheduling, campaign preparation and background dispatch;
- weighted/fair provider selection plus provider quotas/rates/concurrency and shared account/domain/campaign ceilings;
- warm-up profiles, adaptive slowdown, durable pressure reconstruction and gradual recovery;
- provider `Retry-After` parsing, delivery retry timing, provider cooldown and Activity `nextAllowedAt` visibility;
- fail-closed provider policy/enforcement handling;
- suppressions/unsubscribe and complaint/hard-bounce safety brakes;
- truthful provider acceptance versus downstream delivery state;
- tracking/privacy/reputation controls and structured redacted observability;
- ordinary HTML/text + attachment/CID semantics and Image-first composer behavior on the existing message path;
- authorized experiment profiles/runs, bounded scope/windows/usage, kill switch and transport-start checks;
- run-wide experiment concurrency, smooth pacing and bounded-burst pacing;
- explicit UTF-8/transfer-encoding controls where deterministic raw-MIME ownership exists;
- deterministic `cid-inline` runtime binding and deterministic `html` snapshot evidence;
- run-start reproducibility evidence, temporary failover vs policy-stop proof and SHA-256 evidence export;
- evidence/message retention with whole-ledger purge and sensitive terminal snapshot scrubbing;
- Activity experiment summary/configuration/stop/evidence UX in the verified draft stack;
- native bootstrap/preflight, Docker/standalone packaging and the full Quality workflow.

## Intentionally unclaimed behavior

`text`, `hosted-image`, `attachment-only` and `image-dominant` remain experiment metadata only. They are not reported as effective runtime behavior because no separate deterministic existing owner has been proven for those labels without redesigning the message path.

A green repository test does not prove:

- any live provider credential is currently valid;
- a provider account has a particular quota/permission state;
- a sender/domain is currently verified at that provider;
- provider acceptance equals inbox delivery;
- DNS, TLS, webhooks or reverse proxy are reachable on the intended VPS;
- PostgreSQL/Redis persistence, backups or process supervision are correctly installed on the target host.

## Final development acceptance boundary

Before calling development complete, publish the verified PR #78 → #79 stack in dependency order when deployment side effects are authorized, then run the full Quality pipeline on the exact assembled `main` SHA.

That final run must remain green across migrations/drift/upgrade rehearsal, dependency audit, secret scan, type/lint, unit/integration, tenant/race coverage, production build, browser E2E, screenshots and production-container validation. The final review should also confirm privacy/redaction and reasonable bounded-query/refresh behavior.

## Deployment acceptance boundary — deferred

Only after final merged-main Quality is green should deployment work begin. The deployment phase must inspect the actual host and verify:

- required Node/pnpm/runtime prerequisites;
- PostgreSQL and Redis persistence;
- migration application and rollback/restore plan;
- web + worker process supervision and restart behavior;
- reverse proxy, TLS and configured base path;
- production secrets and provider credentials;
- sender/domain authorization and webhook reachability;
- health/readiness endpoints;
- logging/monitoring and backup/restore;
- a small controlled legitimate smoke test.

Vercel is not the acceptance target for the complete EmailSystem runtime. No Vercel or VPS deployment is authorized by this checkpoint.

See `CURRENT_WORK.md`, `DELIVERY_CONTROL_PLANE.md`, `PROVIDERS.md`, `DEPLOYMENT.md`, `ARCHITECTURE.md` and `SECURITY.md` for the governing boundaries.