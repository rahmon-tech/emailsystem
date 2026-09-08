# Current work

## Completed milestone

The **central sending safety governor** is implemented and merged in [PR #3](https://github.com/rahmon-tech/emailsystem/pull/3), merge commit `17ca4e076e4e420021fce57b13a4d6d39c9c6a89`. The platform and provider catalog from PRs #1 and #2 remain intact. The starting main baseline was `846c2887bf72e7b84003b0d49a55eba498f69faa`.

Verified application source: `d6b548dae04bf8992ec73a67a2b077ab6077a327`, [CI run 34290732223](https://github.com/rahmon-tech/emailsystem/actions/runs/34290732223). Its complete source tree was checked against all 104 local tracked files before merge. Subsequent documentation checkpoints preserve that application; [main branch runs](https://github.com/rahmon-tech/emailsystem/actions?query=branch%3Amain) identify the exact commit and CI result for deployment.

## Implemented

Independent rolling 24-hour account, sender-domain, provider and campaign budgets; To/CC/BCC recipient-unit costs; atomic Redis reservations before claims; bounded unstarted leases; durable transport-start markers and UNKNOWN accounting; PostgreSQL reconstruction after Redis loss; weighted routing and shared rate/quotas preserved; deferred campaigns with release times; deduplicated complaint/hard-bounce brakes and explicit administrator review; compact Providers settings, Blast capacity reporting and Activity usage/reasons. Controlled tests consume shared capacity without entering campaign statistics.

The fourth additive migration backfills historical attempt costs and UNKNOWN usage. CI rehearses an upgrade from the exact verified baseline, in addition to fresh database and drift checks. ARCHITECTURE.md defines windows, defaults, bounds, recovery and review semantics. SECURITY.md describes ownership and coordinated rollout.

## Verification

**175 automated tests pass:** 120 unit, 54 real PostgreSQL/Redis integration and one production HTTPS browser workflow. All 154 previous tests remain. Coverage includes exact budget boundaries and copy costs, shared multi-process limits, concurrent reconstruction during claims, 150 recipients paced over a 100-unit budget across days, transport-start expiry, UNKNOWN preservation, unstarted release, authoritative/deduplicated outcomes, suppression, minimum samples, sticky review and tenant isolation.

Lint/type checks, four fresh migrations, upgrade from exact baseline `846c288`, zero schema drift, production build, Caddy validation, Docker image build and web/worker readiness pass. Browser checks exercise Providers/Blast/Activity plus the safety dialog at 390, 430, 768, 1366 and 1536 pixels. Overflow and interaction checks are automated, with screenshots captured as CI artifacts. Provider transports are mocked.

The initial safety run exposed a missing Redis cleanup in the provider test harness; that was repaired. A corrupt local build cache was cleared and the clean production build passed. These are resolved verification issues.

## Completion boundary

This milestone is complete. **Stop here; no next product or architecture slice has been started.** Main CI must be checked on the exact commit selected for deployment.

Live provider credentials, verified sending identities, webhook setup, controlled recipients and VPS/domain access remain necessary to prove real provider delivery and an actual deployment. No live provider or unseen VPS is claimed verified.
