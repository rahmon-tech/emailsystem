# Current work

## Repository truth

Published `main` is exactly `128ba739299db8e3caad3599df9dd7dddfe437c6`.

PR #87 — domain-first sender pools/provider-owned capacity/mobile UX reconciliation — is published. Quality #383 passed on the exact PR head and push-triggered Quality #384 / run `35333756671` passed the complete pipeline on the same exact published `main` SHA.

Repository/CI acceptance is green. This proves the code/build/test/container state, not live provider credentials, DNS/TLS/webhook delivery or the current VPS process state.

## Final feature state

The normal product flow is now Providers → Blast / Image-first → Activity.

Provider setup owns:
- verified sending domain;
- up to ten sender aliases;
- connection-specific daily and monthly hard capacity;
- per-second/per-minute/concurrency limits;
- provider verification and delivery/webhook configuration.

Blast and Image-first choose a verified sending domain rather than a visible From address. Non-experiment deliveries use a deterministic eligible alias assignment behind that domain; retries keep the same sender assignment. Provider authorization is rechecked for the chosen alias immediately before transport. Experiment-bound campaigns remain pinned to their approved sender identity.

Eligible connections for the chosen domain contribute capacity independently. Their configured connection capacity is additive, while explicit account/domain/campaign ceilings, warm-up, suppressions, provider policy state, provider quota/rate/concurrency and adaptive cooldowns can remain stricter.

Shared account/domain/campaign daily ceilings are opt-in. Provider connections default to 5,000 units per rolling 24 hours and 150,000 units per UTC month unless explicitly changed.

The recipient import menu is independently scrollable. Mobile rich-editor focus no longer uses sub-16px editable text, and the toolbar is horizontally stable on touch devices. Blast exposes Image-first mode adjacent to the heading. Hard card outlines were reduced in favor of compact surface hierarchy.

## Repository acceptance

Exact published checkpoint:

- `main`: `128ba739299db8e3caad3599df9dd7dddfe437c6`
- PR-head Quality: #383
- published-main Quality: #384 / run `35333756671`
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

Complete the native/systemd VPS update and environment/provider acceptance. Do not invent additional product feature work unless a concrete defect is found during production acceptance.
