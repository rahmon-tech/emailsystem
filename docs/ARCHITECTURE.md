# Architecture

## Boundaries

`apps/web` is the authenticated Next.js/MUI interface and thin HTTP adapters. `packages/core` owns authentication, imports, campaign transitions, dispatch, attempts, events and suppression. `packages/providers` owns the catalog, endpoints, transport mappings, verification and webhook authentication. `packages/email-renderer` owns HTML normalization and snapshot rendering. `packages/db` contains Prisma and real SQL migrations. `apps/worker` coordinates BullMQ jobs and database recovery.

PostgreSQL is the source of truth. Redis supplies shared rate/concurrency permits, fair-selection counters, throttling, and BullMQ transport. A Redis restart can be recovered by repopulating logical delivery jobs from PostgreSQL. Redis uses AOF persistence and noeviction in production.

## Campaign lifecycle

Pre-flight checks ownership, recipients, copies, sending identity, healthy providers and normalized content. Start persists one immutable snapshot under a unique `(userId,startKey)`. Preparation reads import recipients in batches of 500, commits its cursor and inserts uniquely keyed logical deliveries. A partially prepared campaign cannot dispatch. Scheduling lives on each delivery's eligibility timestamp.

The pump enqueues at most 250 delivery IDs at a time. Worker concurrency is bounded. A delivery takes a distributed provider permit, locks its campaign and recipient suppression key, checks current state and connection revision, then atomically creates one attempt. The provider call occurs outside the database transaction. Its result is recorded in a second transaction.

Pause and cancel serialize with claims through the same campaign row lock. Pause stops new claims. Cancel changes only unclaimed deliveries. In-flight attempts retain their actual result. Cancelling during preparation continues materializing cancelled recipient rows so the exported total remains truthful.

## Delivery semantics

A provider HTTP/SMTP success means `PROVIDER_ACCEPTED`. Only authenticated events establish `DELIVERED`. Hard bounce, complaint and unsubscribe suppression take precedence over late positive notifications. Provider-owned deferrals never requeue an already accepted message.

Explicit temporary rejection retries with exponential backoff and jitter, at most five attempts. Authentication, permission and sender failures disable the connection. Policy enforcement blocks owner dispatch and pauses campaigns until intervention. A lost response, SMTP ambiguity or interrupted worker claim becomes `UNKNOWN`; it is never automatically sent through another provider. Operators should inspect the provider dashboard and restore authenticated event correlation. There is intentionally no blind “retry unknown” button.

Provider-native idempotency is used where documented (Resend API/SMTP). A local attempt ID, provider revision, provider message ID and idempotency key are persisted. Other providers cannot offer a cross-provider exactly-once guarantee; holding unknown outcomes is the deliberate duplicate-prevention boundary.

## Distribution and limits

Weighted virtual finish scores select eligible providers. One atomic Redis script uses Redis server time for per-second and per-minute recipient counts and leased concurrency. CC/BCC copies consume recipient capacity. Connections to the same provider/domain/region share the most conservative configured limit. This avoids treating additional credentials as additional provider quota. Shared limits are conservative and can under-utilize genuinely independent accounts using the same domain.

Rate windows are fixed seconds/minutes. Operators must configure conservative values within their actual provider account limits. SES verification constrains the configured per-second value to the account's reported maximum and stores its remaining daily quota. Claims atomically reserve this budget across connections in the same provider/domain/region group. A bounded worker refresh checks SES quota every five minutes; external sending and provider reporting delays still require conservative headroom. Provider throttles establish cooldowns. Limits are not a mechanism for bypassing provider enforcement.

## Events, activity and retention

Webhook authentication operates on raw bytes. Only normalized, bounded events are stored; raw webhook payloads and secrets are not retained. Events are durably inserted before correlation so early notifications are not lost. Duplicate keys are unique per connection. Unmatched events are retried with a delay so they do not starve matching notifications.

SSE reads account-scoped durable Activity IDs, accepts Last-Event-ID on reconnect, rechecks the session, and reconnects every 55 seconds. The UI retains at most 300 feed rows while summary counts come from PostgreSQL. Full addresses are available only in the authorized recipient inspector and export; live feed addresses are masked.

Normalized webhook events, verbose activity, expired sessions and eligible old rejected attempts have retention sweeps. Campaign and recipient summary truth, uncertain attempts and accepted message correlation are preserved. Queue job data is removed once processed; PostgreSQL repopulates retryable work. Keep routine database backups and size monitoring in place.
