# Current work

## Repository and review

The private repository `rahmon-tech/emailsystem` was originally empty. The directive is preserved in MASTER_DIRECTIVE.md. The application is on `codex/emailsystem-platform`, with [draft PR #1](https://github.com/rahmon-tech/emailsystem/pull/1). Automatic approval review rejected updating the default branch because publishing to `main` had not been explicitly authorized; the review branch provides the concrete implementation for approval.

## Implemented

Authentication and ownership; both PostgreSQL migrations; encrypted catalog connections and all required API/SMTP adapters; native verification and controlled tests; imports and deduplication; rich text/source composer and sanitized immutable snapshots; durable preparation and BullMQ dispatch; weighted Redis limits, quota reservation, cooldowns and bounded retries; unknown reconciliation; authenticated webhooks, suppression and unsubscribe; Activity, controls, filtering and export; production Docker/Caddy configuration; documentation and CI.

## Verification

The recorded application checkpoint is `9e154e9e77c360be9fd2ddb96a0e6554e2ec4b0f`, [CI run 34267560407](https://github.com/rahmon-tech/emailsystem/actions/runs/34267560407). It passes 87 unit tests, 13 real PostgreSQL/Redis integration tests, one complete HTTPS browser workflow, type checking, lint, both fresh migrations/schema drift and the production Next.js build. The browser covers five requested viewport widths and proves work progresses after the worker restarts.

Subsequent review changes preserve loaded recipient pages during polling, add populated-screen captures, validate the production Caddy configuration and complete the verification/deployment report. The current PR head runs the full CI workflow again. Consult its Checks tab for the exact head status; a prior passing commit does not stand in for that result.

See [VERIFICATION](VERIFICATION.md) for test scope, architecture, provider methods, production container checks, verification boundaries and exact deployment commands.

## Remaining external work

Approval to merge the review branch; actual provider credentials/sending identities/controlled recipients for live acceptance and authenticated delivery proof; and VPS/domain access for a real deployment. No live provider or unseen VPS is claimed verified.

## Continuation decisions

PostgreSQL owns durable truth; Redis coordinates work. Unknown sends stop for reconciliation. Provider acceptance and confirmed delivery are separate. SMTP has a whole-operation deadline below its concurrency lease. Authenticated recipient notifications and unsubscribe are idempotent. Imported HTML remains HTML; unsupported Outlook conditional blocks are removed with a warning. Mock connections require explicit configuration. TypeScript 6/ESLint 9 are pinned for the installed Next.js lint dependencies. Repository-backed code is maintained in GitHub.
