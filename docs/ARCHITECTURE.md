# Architecture

## Boundaries

`apps/web` is the authenticated Next.js/MUI interface and thin HTTP adapters. `packages/core` owns authentication, imports, campaign transitions, dispatch, attempts, events and suppression. `packages/providers` owns the catalog, endpoints, transport mappings, verification and webhook authentication. `packages/email-renderer` owns HTML normalization and snapshot rendering. `packages/db` contains Prisma and real SQL migrations. `apps/worker` coordinates BullMQ jobs and database recovery.

PostgreSQL is the source of truth. Redis supplies shared rate/concurrency permits, rolling safety reservations, fair-selection counters, throttling, and BullMQ transport. A Redis restart can be recovered by repopulating logical delivery jobs from PostgreSQL. Redis uses AOF persistence and noeviction in production.

## Campaign lifecycle

Pre-flight checks ownership, recipients, copies, sending identity, healthy providers and normalized content. Start persists one immutable snapshot under a unique `(userId,startKey)`. Preparation reads import recipients in batches of 500, commits its cursor and inserts uniquely keyed logical deliveries. A partially prepared campaign cannot dispatch. Scheduling lives on each delivery's eligibility timestamp.

The pump enqueues at most 250 delivery IDs at a time. Worker concurrency is bounded. A delivery locks the account safety key, campaign and recipient suppression key, checks suppression and safety budgets, then takes a distributed provider permit and atomically reserves all applicable daily budgets before claiming. The account lock also serializes settings, outcome brakes and Redis restoration. Rendering and decryption happen before the durable transport-start marker. A second transaction rechecks campaign, suppression, provider revision and current safety settings, promotes the reservation and records transport start. The provider call occurs outside the database transaction; a later transaction records its result.

Pause and cancel serialize with claims through the same campaign row lock. Pause stops new claims. Cancel changes only unclaimed deliveries. In-flight attempts retain their actual result. Cancelling during preparation continues materializing cancelled recipient rows so the exported total remains truthful.

## Delivery semantics

A provider HTTP/SMTP success means `PROVIDER_ACCEPTED`. Only authenticated events establish `DELIVERED`. Hard bounce, complaint and unsubscribe suppression take precedence over late positive notifications. Provider-owned deferrals never requeue an already accepted message.

Explicit temporary rejection retries with exponential backoff and jitter, at most five attempts. Authentication, permission and sender failures disable the connection. Policy enforcement blocks owner dispatch and pauses campaigns until intervention. A lost response, SMTP ambiguity or interrupted worker claim becomes `UNKNOWN`; it is never automatically sent through another provider. Operators should inspect the provider dashboard and restore authenticated event correlation. There is intentionally no blind “retry unknown” button.

Provider-native idempotency is used where documented (Resend API/SMTP). A local attempt ID, provider revision, provider message ID and idempotency key are persisted. Other providers cannot offer a cross-provider exactly-once guarantee; holding unknown outcomes is the deliberate duplicate-prevention boundary.

## Distribution and limits

Weighted virtual finish scores select eligible providers. One atomic Redis script uses Redis server time for per-second and per-minute recipient counts and leased concurrency. CC/BCC copies consume recipient capacity. Connections to the same provider/domain/region share the most conservative configured limit. This avoids treating additional credentials as additional provider quota. Shared limits are conservative and can under-utilize genuinely independent accounts using the same domain.

Rate windows are fixed seconds/minutes. Operators must configure conservative values within their actual provider account limits. SES verification constrains the configured per-second value to the account's reported maximum and stores its remaining daily quota. Claims atomically reserve this budget across connections in the same provider/domain/region group. A bounded worker refresh checks SES quota every five minutes; external sending and provider reporting delays still require conservative headroom. Provider throttles establish cooldowns. Limits are not a mechanism for bypassing provider enforcement.

## Central sending safety governor

`core/safety-governor.ts` owns rolling reservations independently of weighted provider selection. The order is suppression → daily budget eligibility → compatible/healthy provider pool → existing weighted rate dispatcher → atomic daily reservation → claim → transport-start marker → provider call. Both permits are required before a claim. The dispatcher retains its provider/domain/region shared rate limits, including peers excluded only because their daily budget is exhausted.

| Scope | Default units / rolling 24h | Configuration |
| --- | ---: | --- |
| Account/user | 10,000 | Shared across all owned senders, campaigns and connections |
| Sender domain within user | 5,000 | One default applies independently to each sender domain |
| Provider connection | 5,000 | Default plus optional connection override |
| Campaign | 5,000 | Default copied at creation; optional per-campaign API override; explicit `null` disables only this cap |

One attempted campaign message costs **1 To + every CC + every BCC**. Every started transport attempt consumes units, including rejected requests, retries and UNKNOWN results; provider acceptance does not refund a request already transmitted. Controlled tests also consume one account/domain/provider unit, conservatively including native test modes, while remaining outside campaign statistics. Provider quota, compatibility, health, cooldown, rate and concurrency restrictions still apply independently. The most restrictive applicable limit governs; more providers never multiply account, domain or campaign capacity.

Redis uses server time and a single atomic Lua operation to check and reserve all scopes. Each account has one Redis hash containing its counters, readiness marker and short-lived reservations, so eviction cannot silently remove only part of its protection. Minute buckets are retained until the **end** of their minute plus 24 hours: a genuine rolling window with up to 60 seconds of conservative hold time, never a midnight reset. Running scope totals make normal claims independent of the number of sent messages. Expiration/next-release work scans at most 1,441 bucket positions per applicable scope. The ledger is rebuilt at least daily to discard inactive historical scope fields.

Unstarted reservations have a three-minute lease. Failed claims, rendering/decryption failures and recovered unstarted claims release capacity; waiting campaigns are awakened after release. PostgreSQL records each campaign attempt's reservation timestamp, transport-start timestamp, units and sender domain. A worker interruption after the transport-start marker stays counted and becomes UNKNOWN, including the conservative case of a crash immediately before the actual network call. UNKNOWN is never automatically retried or refunded on a timeout. Authoritative provider reconciliation can establish acceptance/delivery; normal rolling expiry eventually releases its units.

A missing Redis ledger fails closed. `rebuildSafety(userId)` holds the same PostgreSQL account lock as claims and restores grouped minute usage from persisted attempts and controlled-test history, plus still-live unstarted reservations. The atomic replacement cannot expose a partially restored ledger. Ordinary dispatch never scans attempt history. PostgreSQL remains authoritative; there is no duplicated database usage counter. The additive migration conservatively backfills historical UNKNOWN attempts and derives their units/domain from immutable campaign snapshots.

Campaign size is distinct from available capacity. Pre-flight reports both and permits campaigns larger than a daily budget. Exhaustion stores a campaign wait reason and release time without failing recipients or consuming retry attempts. The pump excludes waiting campaigns until due; already queued jobs return without new claims. Activity shows account/domain usage and a daily wait reason separately from provider rates. A message whose own To/CC/BCC cost exceeds a configured global or campaign budget requires configuration correction. No campaign-size hard maximum or automatic warm-up/ramp is introduced.

### Outcome safety brakes

Confirmed provider outcomes are evaluated over a **seven-day cohort** of accepted recipient units. Each unique delivery/envelope recipient contributes once, including audit copies; retries, duplicate event IDs and semantically repeated notifications do not inflate counts. Recipients already suppressed before the accepted attempt are excluded. Local failures, unclaimed recipients and UNKNOWN without acceptance proof are not accepted samples. Missing/unconfigured provider webhooks cannot establish complaint or bounce evidence.

Defaults: **0.1% complaints**, **2% hard bounces**, minimum **100 accepted recipient units**, account and campaign scopes enabled. These deliberately conservative operational defaults are not provider guarantees. Bounds are 0.01–1% complaints, 0.1–10% hard bounces, and samples of 100–100,000. Daily budgets are integers from 1–10,000,000; zero never means unlimited. Operators can select account, campaign or both brake scopes.

Threshold crossings persist a sticky pause, pause active campaigns in the selected scope, and emit `safety.auto_paused`. Preparing campaigns finish materialization into PAUSED. Changing thresholds, waiting or restarting workers cannot clear this pause. The account owner is its administrator in this self-hosted system: an explicit acknowledged review clears the safety hold and starts a fresh outcome cohort; a separate Resume action is still required. Provider policy blocks prevent review/resume until the provider block is resolved. The governor never routes around enforcement.

Settings and review actions are audited. Limit-reached audits are throttled per account and scope kind to once per five minutes; Activity emits a wait transition rather than an event for every rejected reservation.

## Events, activity and retention

Webhook authentication operates on raw bytes. Only normalized, bounded events are stored; raw webhook payloads and secrets are not retained. Events are durably inserted before correlation so early notifications are not lost. Duplicate keys are unique per connection. Unmatched events are retried with a delay so they do not starve matching notifications.

SSE reads account-scoped durable Activity IDs, accepts Last-Event-ID on reconnect, rechecks the session, and reconnects every 55 seconds. The UI retains at most 300 feed rows while summary counts come from PostgreSQL. Full addresses are available only in the authorized recipient inspector and export; live feed addresses are masked.

Normalized webhook events, verbose activity, expired sessions and eligible old rejected attempts have retention sweeps. Campaign and recipient summary truth, uncertain attempts and accepted message correlation are preserved. Queue job data is removed once processed; PostgreSQL repopulates retryable work. Keep routine database backups and size monitoring in place.
