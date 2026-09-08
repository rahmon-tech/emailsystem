# Current work

## Active milestone

Implement the **central sending safety governor only**, tracked in [PR #3](https://github.com/rahmon-tech/emailsystem/pull/3), branch `codex/sending-safety-governor`. The verified parent is `846c2887bf72e7b84003b0d49a55eba498f69faa`, [CI run 34280909213](https://github.com/rahmon-tech/emailsystem/actions/runs/34280909213). The platform and provider catalog were already merged in PRs #1 and #2 and are preserved.

## Implemented

Independent rolling 24-hour account, sender-domain, provider and campaign budgets; To/CC/BCC recipient-unit costs; atomic Redis reservations before claims; bounded unstarted leases; durable transport-start markers and UNKNOWN accounting; PostgreSQL reconstruction after Redis loss; shared weighted rate/quotas preserved; deferred campaigns with release times; deduplicated complaint/hard-bounce brakes and explicit administrator review; compact Providers settings, Blast capacity reporting and Activity usage/reasons. Controlled tests consume shared capacity without entering campaign statistics.

The fourth additive migration backfills historical attempt costs and UNKNOWN usage. CI rehearses an upgrade from the exact verified parent, in addition to a fresh database and drift check. ARCHITECTURE.md defines windows, defaults, bounds, recovery and review semantics. SECURITY.md describes ownership and coordinated rollout.

## Verification checkpoint

Source `cbfed49d3bcc4d9ff8c38a9d6f9d4fb452acc543`, [CI run 34290077566](https://github.com/rahmon-tech/emailsystem/actions/runs/34290077566), passes all 173 tests (120 unit, 52 real PostgreSQL/Redis integration, one production HTTPS browser workflow), migrations/upgrade/drift, production build, responsive UI and container readiness gates. The provider-test Redis cleanup was repaired after the first run exposed an open connection. Local lint, type checking, 120 unit tests and a clean production build pass.

The final candidate adds explicit rebuild-versus-claim and transport-start-window regressions, guards quota refunds against a newer provider report, and excludes unstarted reservations from provider acceptance metrics. Run the entire workflow on that exact candidate before merging, then verify the exact resulting main SHA. Do not claim the final candidate verified from a previous run.

## Completion boundary

After the final candidate is green, merge PR #3, reconcile this checkpoint to the verified source and merge, verify final main CI, and **stop this milestone**. Do not begin another architecture or product slice.

Live provider credentials, verified sending identities, webhook setup, controlled recipients and VPS/domain access are still required to prove real provider delivery and an actual deployment. No live provider or unseen VPS is claimed verified.
