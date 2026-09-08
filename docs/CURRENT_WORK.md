# Current work

## Repository and review

The private repository `rahmon-tech/emailsystem` was originally empty. The directive is preserved in MASTER_DIRECTIVE.md. After the user authorized continuation of the merge, [PR #1](https://github.com/rahmon-tech/emailsystem/pull/1) was merged into `main` as `b1fda1ed437f86afbba2c245794dfc99b22a5c07`. Its verified source head was `a59bc4391623dbaca76393645e4b2c5c69c456c7`. The earlier default-branch approval block is resolved.

## Implemented

Authentication and ownership; both PostgreSQL migrations; encrypted catalog connections and all required API/SMTP adapters; native verification and controlled tests; imports and deduplication; rich text/source composer and sanitized immutable snapshots; durable preparation and BullMQ dispatch; weighted Redis limits, quota reservation, cooldowns and bounded retries; unknown reconciliation; authenticated webhooks, suppression and unsubscribe; Activity, controls, filtering and export; production Docker/Caddy configuration; documentation and CI.

## Verification

The verified application checkpoint is `a59bc4391623dbaca76393645e4b2c5c69c456c7`, [CI run 34268761333](https://github.com/rahmon-tech/emailsystem/actions/runs/34268761333). It passes 87 unit tests, 13 real PostgreSQL/Redis integration tests, one complete HTTPS browser workflow, type checking, lint, both fresh migrations/schema drift, the production Next.js build, Caddy validation and Docker web/worker readiness. The browser captures populated screens at all five requested widths and proves work progresses after the worker restarts.

The merged application also preserves loaded recipient pages during polling. This documentation checkpoint changes only project status and deployment instructions to reflect `main`. Pushes to `main` run the complete CI workflow; [branch runs](https://github.com/rahmon-tech/emailsystem/actions?query=branch%3Amain) identify each resulting SHA and its exact verification status.

See [VERIFICATION](VERIFICATION.md) for test scope, architecture, provider methods, production container checks, verification boundaries and exact deployment commands.

## Remaining external work

Actual provider credentials/sending identities/controlled recipients are needed for live acceptance and authenticated delivery proof, along with VPS/domain access for a real deployment. No live provider or unseen VPS is claimed verified. The next external step is deployment and controlled live-provider onboarding using DEPLOYMENT.md and PROVIDERS.md.

## Continuation decisions

PostgreSQL owns durable truth; Redis coordinates work. Unknown sends stop for reconciliation. Provider acceptance and confirmed delivery are separate. SMTP has a whole-operation deadline below its concurrency lease. Authenticated recipient notifications and unsubscribe are idempotent. Imported HTML remains HTML; unsupported Outlook conditional blocks are removed with a warning. Mock connections require explicit configuration. TypeScript 6/ESLint 9 are pinned for the installed Next.js lint dependencies. Repository-backed code is maintained in GitHub.
