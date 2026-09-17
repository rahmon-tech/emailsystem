# Current work

## Repository truth

Published `main` is now exactly `5ea40e51cbbc7848b02c3945d064e0c7e86ce580`.

The verified #78 → #79 → #82 → #83 → #84 stack was published by a non-forced fast-forward from the previous `main` checkpoint `ce87caa214f60247cb06a0089dcd405ed719b855`. The compare was ahead-only, so publication preserved the already-verified commit ancestry rather than creating replacement implementation commits.

Quality #345 / run `35284283698` passed the complete push-triggered pipeline on exact published `main` SHA `5ea40e51cbbc7848b02c3945d064e0c7e86ce580`, including production-container validation.

The development/publication freeze is therefore complete. Repository/CI acceptance is green. CI does **not** prove provider-account credentials, DNS/TLS/webhook reachability, inbox placement, or an installed VPS runtime.

## Published final development stack

The following formerly stacked checkpoints are now contained in `main`:

1. PR #78 — Activity experiment controls/configuration
   - exact head `e135ad5a196d5a67d65b8d475f53eef2e4f4da48`
   - Quality #319 / run `35239476640` green

2. PR #79 — Activity evidence review
   - exact head `0cd6e8ac24901cff948e88015d41b0fcc3a993ef`
   - Quality #320 green

3. PR #82 — repository-truth documentation reconciliation
   - exact head `c4fc22e56f906ab4f8811ace783a77ee8d16d0fd`
   - Quality #328 / run `35264063476` green

4. PR #83 — bounded Activity evidence verification cost/race hardening
   - exact head `93e35f5125d3ec212565bc2d6d5b07ffc2aea333`
   - Quality #342 / run `35267311307` green

5. PR #84 — final pre-publication canonical documentation checkpoint
   - exact head `5ea40e51cbbc7848b02c3945d064e0c7e86ce580`
   - Quality #344 / run `35280902536` green

The same exact #84 head is now published `main`, and Quality #345 proves the assembled branch state after publication.

## Completed product foundation

The repository now has the intended Providers → Blast / Image-first → Activity workflow on the existing TypeScript/pnpm architecture with Next.js + MUI, PostgreSQL/Prisma, Redis coordination, an independent worker, provider adapters and one shared renderer/MIME path.

Completed and repository-verified capabilities include:

- encrypted provider configuration/verification, sender/domain authorization and tenant scoping;
- imports, immutable campaign snapshots, preflight, scheduling, background dispatch and reconciliation;
- weighted/fair multi-provider routing with provider-specific quota/rate/concurrency plus provider-independent account/domain/campaign controls;
- warm-up/soft-start profiles, adaptive slowdown, restart reconstruction, gradual recovery and provider cooldowns;
- provider `Retry-After` normalization into delivery retry/cooldown timing and Activity `nextAllowedAt` visibility;
- suppression/unsubscribe, complaint/hard-bounce brakes, policy-block fail-closed behavior and safety budgets;
- truthful provider acceptance versus downstream-delivery state;
- structured/redacted observability, native bootstrap/preflight, Docker/standalone packaging and full Quality CI;
- standards-compliant HTML/text, attachment and inline-CID semantics through one renderer/MIME path;
- Image-first composer behavior through the ordinary campaign/delivery owners;
- authorized experiment profiles/runs, provider/sender/recipient scope, bounded windows, hard recipient/attempt/duration ceilings and kill switch;
- run-wide experiment concurrency, smooth pacing and bounded-burst controls inside production ceilings;
- explicit UTF-8/quoted-printable/base64 experiment transport encoding where raw-MIME ownership is deterministic;
- deterministic `cid-inline` runtime binding and deterministic `html` immutable-snapshot evidence;
- run-start reproducibility evidence, temporary failover vs policy-stop proof and tamper-evident SHA-256 evidence/export;
- evidence/message retention with whole-ledger purge and sensitive terminal snapshot scrubbing;
- Activity pacing/provider pressure/experiment status, approved configuration, operator stop control and bounded evidence review;
- operator-explicit full-chain evidence verification with tamper detection and campaign-keyed stale-response protection.

## Intentionally metadata-only experiment modes

`text`, `hosted-image`, `attachment-only` and `image-dominant` remain accepted experiment metadata values but are not reported as effective runtime behavior.

Repository truth still provides no separate deterministic runtime owner for those labels without redesigning the existing message path. They are intentionally deferred and are not development-completion blockers.

## Development acceptance

Development/publication acceptance is complete at:

- published `main`: `5ea40e51cbbc7848b02c3945d064e0c7e86ce580`
- assembled-main Quality: #345 / run `35284283698`
- result: full pipeline green

That run covers fresh migrations, schema drift, upgrade rehearsal, production dependency audit, secret scan, lint, strict TypeScript, unit/integration tests, production build, Playwright E2E, screenshot emission and production-container validation.

Do not reinterpret this as proof that a real provider account or VPS is correctly configured.

## Next phase — deployment and provider-account acceptance

The next legitimate work is environment-specific acceptance rather than more feature churn.

The actual target remains the self-hosted web + worker + PostgreSQL + Redis runtime. Vercel is not the acceptance target for the complete EmailSystem system.

Deployment/provider acceptance should verify, against the real environment:

- Node/pnpm/runtime prerequisites or Docker runtime as chosen;
- PostgreSQL and Redis persistence;
- migration application and restore/rollback procedure;
- web and independent worker supervision/restart behavior;
- reverse proxy, TLS and the configured base path;
- production secrets and provider credentials;
- sender/domain authorization;
- webhook reachability/authentication;
- health/readiness and observability;
- backups/restore;
- provider-account quota/permission reality;
- a tightly controlled legitimate smoke test.

No CI result should be used as a substitute for those host/provider checks.

## Non-negotiable architecture boundaries

Preserve the existing owners. Do not introduce a second campaign model, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, test-send path, renderer or MIME stack.

Experiments may vary behavior only inside their authorized envelope. Production ceilings, sender authorization, recipient scope, suppression, complaint/bounce brakes, provider policy state, hard run limits and kill switch remain authoritative. Metadata-only values must never be presented as effective runtime behavior without deterministic proof.

## Next action

Reconcile the canonical verification/control-plane docs and issue #21 to published `main` + Quality #345, verify that documentation-only checkpoint, then proceed with environment-specific deployment/provider acceptance when the actual host/provider access path is available.
