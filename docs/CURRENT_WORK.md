# Current work

## Repository truth

Published `main` is exactly `4b33adaa24cff03940ffddd2642b2a170481d844`.

PR #89 — multi-domain campaign pools and user-first sending UX — is published. Quality #455 / run `35363742131` passed the complete repository pipeline on the exact merged `main` SHA.

Repository/CI acceptance is green. This proves the code/build/test/container state, not live provider credentials, DNS/TLS/webhook delivery or the current VPS process state.

## Final feature state

The normal product flow is now Sending services → Create campaign / Image-first → Activity.

Provider setup owns:
- verified sending domain;
- up to ten From addresses per domain;
- connection-specific daily and monthly hard capacity;
- per-second/per-minute/concurrency limits;
- connection verification and delivery-update/webhook configuration.

Standard and Image-first campaigns can select one or more verified sending domains, with existing single-domain behavior preserved. Non-experiment deliveries rotate only across currently viable domain/From-address/sending-service routes. Disabled, blocked or terminally broken connections leave the active pool instead of poisoning healthy routes. Controlled experiments remain pinned to their approved sender and fail closed on provider policy enforcement.

Configured connection capacity is additive across independent connections. Shared account/domain/campaign rolling-24-hour and monthly ceilings can remain stricter, and live Activity status reflects the current usable route pool before resume/retry. Retry requeues only definitively failed recipients; UNKNOWN and already accepted outcomes remain untouched.

The mobile workspace header is sticky. MUI menus use bounded internal scrolling on mobile so long dropdowns do not scroll the whole page. User-facing copy is audited across the web surface to avoid exposing internal dispatch/transport/safety terminology where ordinary language is sufficient. Provider onboarding now saves the connection first, exposes its permanent delivery-update URL, then accepts the provider signing/event credential.

## Repository acceptance

Exact published checkpoint:

- `main`: `4b33adaa24cff03940ffddd2642b2a170481d844`
- merged PR: #89
- Quality: #455 / run `35363742131`
- result: full pipeline green

The full pipeline includes dependency audit, Prisma generation, fresh migrations, schema drift, upgrade rehearsal, lint, secret scan, strict TypeScript, unit tests, PostgreSQL/Redis integration tests, production Next.js build, Playwright browser E2E, screenshot emission and production-container validation.

## Deployment checkpoint

The last recorded VPS checkpoint is a native/systemd installation under `/opt/emailblast`, not the Docker Compose first-install path.

At that checkpoint:
- `emailblast-web.service` and `emailblast-worker.service` were enabled and running;
- the web process targeted `127.0.0.1:3087`;
- PostgreSQL was reachable on `127.0.0.1:55432`;
- repository migrations had been applied;
- readiness eventually returned `{"status":"ready"}`;
- the public proxy briefly returned 502 during restart/startup, so the current live route must be rechecked before and after the update.

The next server action is therefore an in-place native update: inspect current state, back up the database and protected environment, fast-forward the checkout to the verified release, install locked dependencies, run native bootstrap checks, build with `NEXT_PUBLIC_BASE_PATH=/emailblast`, apply only the required migration after backup, restart the EmailSystem worker/web services, then verify loopback and public readiness while preserving the existing root site.

## Intentionally deferred experiment metadata

`text`, `hosted-image`, `attachment-only` and `image-dominant` remain accepted experiment metadata only unless a deterministic existing runtime owner is later proven without redesign. They are not product-completion blockers.

## Next action

Complete the native/systemd VPS update to the verified `4b33adaa24cff03940ffddd2642b2a170481d844` release and perform environment/provider acceptance. Do not invent additional product feature work unless a concrete defect is found during production acceptance.
