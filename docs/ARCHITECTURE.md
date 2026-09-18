# EmailBlast architecture

## Boundaries

`apps/web` is the authenticated Next.js/MUI interface and thin HTTP adapters. `packages/core` owns authentication, imports, campaign transitions, dispatch, attempts, events and suppression. `packages/providers` owns the catalog, endpoints, transport mappings, verification and webhook authentication. `packages/email-renderer` owns HTML normalization and snapshot rendering. `packages/db` contains Prisma and real SQL migrations. `apps/worker` coordinates BullMQ jobs and database recovery.

PostgreSQL is the source of truth. Redis supplies shared rate/concurrency permits, rolling safety reservations, fair-selection counters, throttling, and BullMQ transport. A Redis restart can be recovered by repopulating logical delivery jobs from PostgreSQL. Redis uses AOF persistence and noeviction in production.

## Campaign lifecycle

Pre-flight resolves a tenant-owned `SenderIdentity`, checks its domain/provider authorizations, recipients, copies, provider health and normalized content. Arbitrary From text is not a dispatch input. Start stores the chosen sender ID and one immutable snapshot under a unique `(userId,startKey)`. Preparation reads import recipients in batches of 500, commits its cursor and inserts uniquely keyed logical deliveries. A partially prepared campaign cannot dispatch. Scheduling lives on each delivery's eligibility timestamp.

The pump enqueues at most 250 delivery IDs at a time. Worker concurrency is bounded. A delivery locks the account safety key, campaign and recipient suppression key, checks suppression, sender authorization and safety budgets, then takes a distributed provider permit and atomically reserves all applicable daily budgets before claiming. The account lock also serializes settings, outcome brakes and Redis restoration. Rendering and decryption happen before the durable transport-start marker. A second transaction rechecks campaign, suppression, sender/provider authorization, provider revision and current safety settings, promotes the reservation and records transport start. Transport start must occur within 20 seconds of acquiring the 120-second concurrency permit, leaving room for the 90-second provider deadline. The provider call occurs outside the database transaction; a later transaction records its result.

Pause and cancel serialize with claims through the same campaign row lock. Pause stops new claims. Cancel changes only unclaimed deliveries. In-flight attempts retain their actual result. Cancelling during preparation continues materializing cancelled recipient rows so the exported total remains truthful.

## Delivery semantics

A provider HTTP/SMTP success means `PROVIDER_ACCEPTED`. Only authenticated events establish `DELIVERED`. Hard bounce, complaint and unsubscribe suppression take precedence over late positive notifications. Provider-owned deferrals never requeue an already accepted message.

Explicit temporary rejection retries with exponential backoff and jitter, at most five attempts. Authentication, permission and sender failures disable the connection. Policy enforcement blocks owner dispatch and pauses campaigns until intervention. A lost response, SMTP ambiguity or interrupted worker claim becomes `UNKNOWN`; it is never automatically sent through another provider. Operators should inspect the provider dashboard and restore authenticated event correlation. There is intentionally no blind “retry unknown” button.

Provider-native idempotency is used where documented (Resend API/SMTP). A local attempt ID, provider revision, provider message ID and idempotency key are persisted. Other providers cannot offer a cross-provider exactly-once guarantee; holding unknown outcomes is the deliberate duplicate-prevention boundary.

## Distribution and limits

Weighted virtual finish scores select eligible providers. One atomic Redis script uses Redis server time for per-second and per-minute recipient counts and leased concurrency. CC/BCC copies consume recipient capacity. Each saved provider connection keeps its own configured per-second, per-minute and concurrency limits. Connections authorized for the same sender domain also participate in one provider-independent domain pacing lane whose derived ceiling is the sum of the currently eligible connection limits; an explicit sender-domain ceiling, warm-up policy or adaptive slowdown may reduce that effective pace.

Rate windows are fixed seconds/minutes. Operators must configure each connection within its real provider/account limits; creating another credential record is not evidence that a provider account granted more quota. SES verification constrains that connection's configured per-second value to the account's reported maximum and stores its remaining daily quota. Provider throttles establish connection cooldowns. Limits are never a mechanism for bypassing provider enforcement or sender authorization.

## Central sending safety governor

`core/safety-governor.ts` owns rolling reservations independently of weighted provider selection. The order is suppression → daily budget eligibility → compatible/healthy provider pool → weighted rate dispatcher → atomic daily reservation → claim → transport-start marker → provider call. Both permits are required before a claim. Provider connection limits remain connection-scoped; the sender-domain pacing lane coordinates aggregate eligible throughput and may be constrained further by explicit account/domain/campaign pacing ceilings and warm-up.

| Scope                     | Default capacity | Configuration |
| ------------------------- | ---------------: | ------------- |
| Account/user              | No shared cap | Optional rolling 24-hour ceiling shared across all owned senders, campaigns and connections |
| Sender domain within user | No shared cap | Optional rolling 24-hour ceiling for the selected sender domain |
| Provider connection       | 5,000 / rolling 24h + 150,000 / UTC month | Saved per SMTP/API connection; editable in Providers |
| Campaign                  | No shared cap | Optional rolling 24-hour campaign ceiling; blank means no additional campaign cap |

One attempted campaign message costs **1 To + every CC + every BCC**. Every started transport attempt consumes units, including rejected requests, retries and UNKNOWN results; provider acceptance does not refund a request already transmitted. Controlled tests also consume one account/domain/provider unit, conservatively including native test modes, while remaining outside campaign statistics. Provider quota, compatibility, health, cooldown, rate and concurrency restrictions still apply independently. The most restrictive applicable limit governs. Eligible provider-connection capacity is additive; when an account, sender-domain or campaign ceiling is configured, that shared ceiling remains authoritative even if the summed provider capacity is higher.

Redis uses server time and a single [atomic Lua operation](https://redis.io/docs/latest/develop/programmability/eval-intro/) to check and reserve all scopes. Each account has one Redis hash containing its counters, readiness marker and short-lived reservations, so eviction cannot silently remove only part of its protection. Minute buckets are retained until the **end** of their minute plus 24 hours: a genuine rolling window with up to 60 seconds of conservative hold time, never a midnight reset. Running scope totals make normal claims independent of the number of sent messages. Expiration/next-release work scans at most 1,441 bucket positions per applicable scope. The ledger is rebuilt at least daily to discard inactive historical scope fields.

Unstarted reservations have a three-minute lease. Failed claims, rendering/decryption failures and recovered unstarted claims release capacity; waiting campaigns are awakened after release. PostgreSQL records each campaign attempt's reservation timestamp, transport-start timestamp, units and sender domain. A worker interruption after the transport-start marker stays counted and becomes UNKNOWN, including the conservative case of a crash immediately before the actual network call. UNKNOWN is never automatically retried or refunded on a timeout. Authoritative provider reconciliation can establish acceptance/delivery; normal rolling expiry eventually releases its units.

A missing Redis ledger fails closed. `rebuildSafety(userId)` holds the same PostgreSQL account lock as claims and restores grouped minute usage from persisted attempts and controlled-test history, plus still-live unstarted reservations. The atomic replacement cannot expose a partially restored ledger. Ordinary dispatch never scans attempt history. PostgreSQL remains authoritative; there is no duplicated database usage counter. The additive migration conservatively backfills historical UNKNOWN attempts and derives their units/domain from immutable campaign snapshots.

Campaign size is distinct from available capacity. Pre-flight reports both and permits campaigns larger than a daily budget. Exhaustion stores a campaign wait reason and release time without failing recipients or consuming retry attempts. The pump excludes waiting campaigns until due; already queued jobs return without new claims. Activity shows account/domain usage and a daily wait reason separately from provider rates. A message whose own To/CC/BCC cost exceeds a configured global or campaign budget requires configuration correction. There is no campaign-size hard maximum. Transport pacing still applies the existing sender-domain warm-up/soft-start and adaptive controls independently of daily/monthly capacity.

### Outcome safety brakes

Confirmed provider outcomes are evaluated over a **seven-day cohort** of accepted recipient units. Each unique delivery/envelope recipient contributes once, including audit copies; retries, duplicate event IDs and semantically repeated notifications do not inflate counts. Recipients already suppressed before the accepted attempt are excluded. Local failures, unclaimed recipients and UNKNOWN without acceptance proof are not accepted samples. Controlled tests remain outside this campaign outcome cohort. Missing/unconfigured provider webhooks cannot establish complaint or bounce evidence.

Defaults: **0.1% complaints**, **2% hard bounces**, minimum **100 accepted recipient units**, account and campaign scopes enabled. These deliberately conservative operational defaults are not provider guarantees. Bounds are 0.01–1% complaints, 0.1–10% hard bounces, and samples of 100–100,000. Daily budgets are integers from 1–10,000,000; zero never means unlimited. Operators can select account, campaign or both brake scopes.

Threshold crossings persist a sticky pause, pause active campaigns in the selected scope, and emit `safety.auto_paused`. Preparing campaigns finish materialization into PAUSED. Changing thresholds, waiting or restarting workers cannot clear this pause. The account owner is its administrator in this self-hosted system: an explicit acknowledged review clears the safety hold and starts a fresh outcome cohort; a separate Resume action is still required. Provider policy blocks prevent review/resume until the provider block is resolved. The governor never routes around enforcement.

Settings and review actions are audited. Limit-reached audits are throttled per account and scope kind to once per five minutes; Activity emits a wait transition rather than an event for every rejected reservation.

## Events, activity and retention

Webhook authentication operates on raw bytes. Only normalized, bounded events are stored; raw webhook payloads and secrets are not retained. Events are durably inserted before correlation so early notifications are not lost. Duplicate keys are unique per connection. Unmatched events are retried with a delay so they do not starve matching notifications.

SSE reads account-scoped durable Activity IDs, accepts Last-Event-ID on reconnect, rechecks the session, and reconnects every 55 seconds. The UI retains at most 300 feed rows while summary counts come from PostgreSQL. Full addresses are available only in the authorized recipient inspector and export; live feed addresses are masked.

Normalized webhook events, verbose activity, expired sessions and eligible old rejected attempts have retention sweeps. Campaign and recipient summary truth, uncertain attempts and accepted message correlation are preserved. Queue job data is removed once processed; PostgreSQL repopulates retryable work. Keep routine database backups and size monitoring in place.

# HTML fidelity and optional click tracking

The existing renderer and pre-flight remain the owners of message preparation. Normalization is deterministic, performs no resource fetching, preserves compatible tables/CSS/media queries and explicitly supported Outlook conditionals/VML, and reports safety removals. It never rewrites copy or subjects for filter evasion. Campaign creation stores the final snapshot once. Tracking changes only eligible HTML anchor/VML hrefs; text, placement, labels, media, mailto/tel/fragment links, existing owned tracking links and unsubscribe paths remain direct. The app-generated unsubscribe footer is appended after tracking preparation. Plain-text destinations remain direct.

Tracking uses native PostgreSQL records and the existing web/worker stack. Redirect URLs derive only from the canonical `APP_URL`, including its configured base path. A campaign can explicitly enable tracking or use the administrator default. There is no second tracking-host architecture, automatic domain rotation, reputation failover or third-party shortener. Tracking defaults off; when off, safe original destinations remain direct and sending has no tracking dependency.

`TrackingLink` stores a random 256-bit opaque token, immutable destination, campaign and owner. Composite foreign keys enforce owner equality. Repeated campaign submissions reuse the stored snapshot and tokens. The public redirect requires the configured `APP_URL` host and exact base-path route and never accepts a destination from request parameters. It refuses expired or locally denied destinations. The feature adds no browser fingerprinting.

`ReputationSource` is the typed plug-in boundary for affirmative clean, blocked and unknown assessments, with bounded concurrency/deadlines. The built-in owner-scoped denied-domain source never treats absence as clean. Optional adapters can be passed to `inspectDestinations` at the existing composition point; installing an external adapter requires its own explicit configuration, licensing/terms review and data-sharing decision. No external service or URL submission is enabled by default. Exceptions, invalid results and timeouts become unknown. Only an explicit strict policy blocks unknown results.

Visits write only UTC daily aggregates per campaign link: raw visits and likely automated visits. All remaining visits are unclassified, not confirmed humans. The redirect has no delivery-state, engagement-confirmation, business-action or provider-event side effect. Aggregate-write failure does not prevent an otherwise valid redirect. PostgreSQL migrations add these records without changing the sending governor or existing delivery truth.
