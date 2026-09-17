# Current work

## Repository truth

Published `main` is PR #72 merge `ce87caa214f60247cb06a0089dcd405ed719b855`. The exact PR #72 head `f6942f6e991b5e15a40485b1b6a441315a22b8e2` passed full Quality #313 before merge.

Deployment is intentionally deferred. Do not deploy to Vercel or the VPS, and do not treat Vercel status as the production acceptance boundary for this repository. The documented production shape remains the self-hosted web + worker + PostgreSQL + Redis runtime.

The verified development stack above published `main` is:

1. PR #78 `feat(activity): add experiment controls and configuration`
   - base: published `main` at `ce87caa214f60247cb06a0089dcd405ed719b855`
   - exact verified head: `e135ad5a196d5a67d65b8d475f53eef2e4f4da48`
   - Quality #319 / run `35239476640`: full pipeline green
   - adds tenant-safe approved experiment configuration visibility and operator stop/review using the existing experiment-run mutation owner

2. PR #79 `feat(activity): review experiment evidence live`
   - stacked base: PR #78 exact verified head `e135ad5a196d5a67d65b8d475f53eef2e4f4da48`
   - exact verified head: `0cd6e8ac24901cff948e88015d41b0fcc3a993ef`
   - Quality #320: full pipeline green
   - adds the minimized tenant-safe evidence review surface

3. PR #82 `docs: reconcile final development checkpoint`
   - stacked base: PR #79 exact verified head `0cd6e8ac24901cff948e88015d41b0fcc3a993ef`
   - exact verified head: `c4fc22e56f906ab4f8811ace783a77ee8d16d0fd`
   - Quality #328 / run `35264063476`: full pipeline green
   - reconciles `CURRENT_WORK.md` and `VERIFICATION.md` without runtime changes

4. PR #83 `fix(activity): bound live evidence verification cost`
   - stacked base: PR #82 exact verified head `c4fc22e56f906ab4f8811ace783a77ee8d16d0fd`
   - exact verified head: `93e35f5125d3ec212565bc2d6d5b07ffc2aea333`
   - Quality #342 / run `35267311307`: full pipeline green
   - completes the pre-publication assembled review by moving 10-second evidence polling to bounded/index-supported summary reads, making full-chain verification operator-explicit, preserving tamper detection, and hardening overlapping-campaign UI state

All four checkpoints remain draft/unmerged intentionally while publication/deployment is frozen. The current PR #84 documentation-reconciliation branch is stacked from PR #83 exact head and changes canonical documentation only; it does not alter runtime behavior.

## Completed product foundation

The repository now has the intended Providers → Blast / Image-first → Activity workflow on the existing TypeScript/pnpm architecture with Next.js + MUI, PostgreSQL/Prisma, Redis coordination, an independent worker, provider adapters and one shared renderer/MIME path.

Completed and verified capabilities include:

- encrypted provider configuration and verification, sender/domain authorization and tenant scoping;
- imports, immutable campaign snapshots, preflight, scheduling, background dispatch and reconciliation;
- weighted/fair multi-provider routing with provider-specific quotas/rates/concurrency and provider-independent account/sender-domain/campaign controls;
- warm-up/soft-start profiles, adaptive slowdown, durable pressure reconstruction, gradual recovery and provider cooldowns;
- HTTP `Retry-After` normalization into `retryAfterMs`; delivery retry and provider cooldown honor the larger applicable delay; Activity telemetry exposes the resulting `nextAllowedAt` provider slot;
- suppressions/unsubscribe, complaint/hard-bounce brakes, policy-block fail-closed behavior and safety budgets;
- tracking with canonical routes, privacy-bounded analytics and truthful provider-acceptance vs downstream-delivery state;
- structured/redacted observability, native bootstrap/preflight, Docker/standalone packaging and full Quality CI;
- standards-compliant HTML/text, attachments, inline CID semantics and Image-first composer behavior without a second renderer or sender;
- authorized experiment profiles/runs, provider/sender/recipient scope, bounded windows, hard recipient/attempt/duration ceilings and kill switch;
- run-wide experiment concurrency, smooth pacing and bounded-burst controls inside ordinary production ceilings;
- explicit UTF-8/quoted-printable/base64 experiment transport encoding where raw MIME ownership is deterministic;
- deterministic `cid-inline` experiment runtime binding and deterministic `html` immutable-snapshot evidence;
- atomic run-start reproducibility snapshot, temporary-failover-vs-policy-stop proof and tamper-evident SHA-256 evidence/export;
- experiment evidence/message retention with whole-ledger evidence purge and sensitive terminal message-snapshot scrubbing;
- Activity pacing/provider pressure/experiment/live status, approved configuration, operator stop control and minimized evidence review in the verified draft stack.

## Intentionally metadata-only experiment modes

`text`, `hosted-image`, `attachment-only` and `image-dominant` remain accepted experiment metadata values but are not reported as effective runtime behavior.

Repository reconciliation found no separate deterministic runtime owner for those labels that can be bound without inventing a second renderer/content-transformation path or redefining existing message semantics. They are therefore intentionally deferred and are not production-completion blockers. Bind one later only if repository truth provides an existing deterministic owner and focused proof.

## What remains before development can be called complete

### 1. Publish the verified pre-publication stack

When publication/deployment side effects are acceptable, publish PR #78 → #79 → #82 → #83 and the final docs-only reconciliation checkpoint in dependency order. Preserve exact-parent/fast-forward discipline where possible and run full Quality on the exact resulting assembled `main` SHA. Do not move `main` while the current instruction to defer deployment remains in force.

### 2. Final assembled-system verification

After the verified stack is published, run one final acceptance pass on the exact assembled `main` SHA covering:

- fresh PostgreSQL migrations, schema drift and upgrade rehearsal;
- high/critical production dependency audit and repository secret scan;
- strict TypeScript and lint;
- unit and PostgreSQL/Redis integration suites;
- tenant isolation and cross-tenant negative proofs;
- mutation concurrency/race proofs for delivery, safety, experiment start/stop, retention and evidence owners;
- provider temporary/rate-limit/policy/auth failure behavior and retry/cooldown truth;
- campaign/provider pacing, warm-up, adaptive slowdown/recovery and `nextAllowedAt` visibility;
- production Next.js build, browser E2E, mobile/desktop screenshots and production-container validation;
- privacy/redaction review of Activity, logs, exports and evidence surfaces;
- reasonable performance sanity for queue discovery, Activity refresh and bounded database queries.

Do not claim production installation from CI alone.

### 3. Final documentation checkpoint

After exact merged-main Quality is green, reconcile this file, `DELIVERY_CONTROL_PLANE.md`, `VERIFICATION.md` and issue #21 to the same SHA and distinguish clearly between:

- implemented and CI-verified behavior;
- account/provider-specific behavior that still requires real credentials;
- deployment-host behavior that requires the actual VPS;
- intentionally deferred optional experiment metadata modes.

### 4. Deployment phase — explicitly deferred

Only after the development checkpoint above is green should work move to the real deployment environment. That later phase must verify PostgreSQL/Redis persistence, worker supervision/restart, reverse proxy/TLS/base path, secrets and provider credentials, webhook reachability, backups/restore, health/readiness, observability and a tightly controlled legitimate smoke test.

Vercel is not the acceptance target for the whole EmailSystem runtime. Do not attempt Vercel or VPS deployment until explicitly authorized.

## Non-negotiable architecture boundaries

Preserve the existing owners. Do not introduce a second campaign model, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, test-send path, renderer or MIME stack.

Experiments may vary behavior only inside their authorized envelope. Production ceilings, sender authorization, recipient scope, suppression, complaint/bounce brakes, provider policy state, hard run limits and kill switch remain authoritative. Metadata-only values must never be presented as effective runtime behavior without deterministic proof.

## Next action

Keep PR #84 documentation-only and run the full Quality pipeline on its exact head. If it is green, hold the complete verified #78 → #79 → #82 → #83 → #84 stack until publication/deployment is explicitly authorized. Do not invent additional feature work merely to keep development moving.