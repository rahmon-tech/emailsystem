# Current work

## Repository and completed changes

EmailSystem is maintained in the private repository `rahmon-tech/emailsystem`. The original platform was merged in [PR #1](https://github.com/rahmon-tech/emailsystem/pull/1). The provider catalog addendum is integrated and merged in [PR #2](https://github.com/rahmon-tech/emailsystem/pull/2), merge commit `6fbdf14e75608374c9ad1d40ca35b63696365250`.

The verified application source is `cc99461660d77163be6cea5aa915111f975c1177`, [CI run 34279952929](https://github.com/rahmon-tech/emailsystem/actions/runs/34279952929). Subsequent documentation commits preserve that application and run the same full workflow. [Main branch runs](https://github.com/rahmon-tech/emailsystem/actions?query=branch%3Amain) identify the exact SHA to deploy.

## Implemented

Authentication and ownership; three PostgreSQL migrations; encrypted catalog connections and all required API/SMTP adapters; provider verification and controlled tests; imports and deduplication; rich text/source composer and sanitized immutable snapshots; durable preparation and BullMQ dispatch; weighted Redis limits, quota reservation, cooldowns and bounded retries; unknown reconciliation; authenticated webhooks, suppression and unsubscribe; Activity, controls, filtering and export; production Docker/Caddy configuration; documentation and CI.

The provider addendum adds central typed authentication/credential fields and help links, regional endpoints, explicit SMTP port/TLS pairs, native verification strategies and test capabilities. Both Postmark SMTP hosts and credential modes are supported; campaigns remain Broadcast-only. Resend Save & Verify never sends. Brevo sandbox validates format without establishing send permission. Controlled-test mode is persisted separately from campaign statistics, with unknown mode retained for historical test rows. Rate limits, enforcement, missing permission and invalid credentials have distinct verification outcomes.

The directives are preserved in MASTER_DIRECTIVE.md and PROVIDER_CATALOG_ADDENDUM.md. PROVIDERS.md contains setup instructions, current official references and documented differences, including the unconfirmed advanced SMTP2GO TLS port 443.

## Verification

**154 automated tests pass:** 117 unit tests, 36 integration tests using real PostgreSQL/Redis, and one production HTTPS browser workflow. Provider transports are mocked. Tests cover literal API/SMTP endpoints, credentials, regions, TLS pairings, no-send verification, persisted provider states, ownership-bound encryption, eligibility, independent controlled tests and the complete campaign workflow.

Lint/type checking, three fresh migrations and schema drift, production Next.js build, Caddy validation, Docker image build and web/worker readiness pass. Browser checks exercise all ten provider forms, Postmark credential/stream changes and populated Providers/Blast/Activity pages at 390, 430, 768, 1366 and 1536 pixels. Worker restart/recovery remains covered.

See VERIFICATION.md for exact scope and the deployment commands.

## Remaining external work

Live account credentials, verified sending identities, quota, notification configuration and controlled recipients are needed to prove real provider acceptance and delivery. VPS/domain access is needed for an actual deployment. No live provider or unseen VPS is claimed verified. Follow DEPLOYMENT.md and PROVIDERS.md for that onboarding.

## Continuation decisions

PostgreSQL owns durable truth; Redis coordinates work. Unknown sends stop for reconciliation. Provider acceptance and confirmed delivery are separate. SMTP has an overall deadline below its concurrency lease and requires validated TLS. Recipient events and unsubscribe remain idempotent. Imported HTML remains HTML; unsupported Outlook conditional blocks are removed with a warning. Mock connections require explicit configuration. Repository-backed code is maintained in GitHub.
