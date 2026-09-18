# EmailBlast features

This document describes the product behavior behind the shorter project overview in the root README.

EmailBlast deliberately separates campaign authoring, durable delivery state, provider transport, and downstream delivery events. The same delivery engine is used by standard and Image-first campaigns.

## Standard campaigns

The standard composer at `/blast` supports both visual authoring and developer-supplied HTML.

### Recipient imports

Recipients can come from:

- CSV;
- TXT;
- XLSX;
- pasted email addresses.

For CSV/XLSX files, EmailBlast recognizes common email headers such as `email`, `e-mail`, `email address`, and `email_address`. If no known header exists, it selects the first column containing a valid address.

Imports record:

- rows inspected;
- valid addresses;
- invalid rows;
- duplicates;
- suppressed addresses;
- final sendable recipients.

Addresses are normalized and deduplicated before persistence. Existing account suppressions are removed from the sendable set during import.

Ready imports remain available as **Saved recipient lists** for later campaigns. Removing a saved list does not rewrite campaigns that already used it.

### Message authoring

The standard composer supports:

- campaign name;
- one or more verified sending domains;
- subject and preview text;
- rich-text authoring;
- HTML-file import;
- raw/source editing;
- optional hand-authored plain text;
- CC and BCC;
- tags;
- scheduling;
- optional click tracking;
- file attachments.

Source mode exists so imported email layouts do not need to be round-tripped through the rich editor.

When explicit plain text is omitted, EmailBlast derives a text alternative from the normalized HTML.

### HTML normalization and preview

Email normalization is deterministic and does not fetch remote resources.

The renderer:

- removes active content such as scripts, forms, iframes, and unsafe event handlers;
- sanitizes unsafe links and image sources;
- sanitizes CSS;
- preserves supported media queries and email-safe formatting;
- inlines CSS;
- preserves supported Outlook conditional/VML fallback markup;
- injects preview text;
- generates plain text;
- produces a deterministic message snapshot hash.

Before launch, the composer can show:

- desktop preview;
- mobile preview;
- plain-text preview;
- prepared HTML/source.

### Controlled test send

A prepared standard or Image-first message can be sent to a controlled test recipient through a selected eligible provider connection.

The test exercises the prepared message/provider path without turning that recipient into normal campaign statistics.

## Image-first campaigns

The dedicated Image-first composer at `/blast/image` is for campaigns whose primary content is one designed image.

It is a product/composition mode, **not a second delivery engine**.

### Message structure

The primary image is stored as an inline attachment with a Content-ID and referenced from the generated HTML:

```text
multipart email
├── plain-text alternative
├── HTML body
│   └── <img src="cid:image-...">
├── inline primary image
│   ├── Content-ID: image-...
│   └── disposition: inline
└── optional normal attachments
```

The image can optionally be wrapped in a normal HTTP(S) destination link. If click tracking is enabled, the normal EmailBlast tracking flow applies.

Alt text is required and is also used as the plain-text fallback.

### Supported controls

Image-first supports:

- PNG, JPEG, GIF, and WebP primary images;
- subject and preview text;
- optional destination link;
- optional click tracking;
- CC/BCC;
- tags;
- scheduling;
- extra file attachments;
- prepared preview;
- provider-aware pre-flight;
- controlled test sends.

Current composer limits include:

- primary image: maximum 5 MB;
- all primary/normal attachments combined: maximum 5 files;
- attachment payload total: maximum 5 MB;
- recipient upload: under 10 MB.

Server-side validation and provider capability checks remain authoritative.

Pre-flight excludes routes that cannot transport inline CID attachments.

## Sending domains and From addresses

EmailBlast treats these as separate objects:

1. **Sending domain** — a verified domain available to the account.
2. **From address** — an enabled sender identity under that domain.
3. **Provider connection** — one configured provider account/transport.

A domain may expose multiple From addresses such as `info@`, `support@`, `hello@`, or `sales@`, each with a display name and optional Reply-To.

Adding more From addresses does not increase sending capacity.

Provider/domain authorization is explicit: a provider connection must be allowed to send for the selected domain/identity before it is eligible for campaign work.

When sender pools are enabled, retries keep the same From address when possible.

## Provider connections

A connection represents one provider account or SMTP transport.

Connection configuration can include:

- connection name;
- API or SMTP mode;
- encrypted credentials;
- sending domain;
- From-address aliases;
- display name and Reply-To;
- provider region or stream;
- traffic-share weight;
- concurrency;
- per-second and per-minute limits;
- rolling 24-hour capacity;
- monthly capacity;
- delivery-webhook authentication.

The Sending services UI can verify a connection, expose verification checks, send a test email, show recent acceptance, enable/disable the connection, and display configured vs effective sending speed.

## Provider routing

Routing becomes relevant only when the selected campaign domain(s) have more than one eligible connection.

A route must satisfy the current delivery's authorization and capacity requirements. Eligibility may be affected by:

- connection enabled state;
- provider verification;
- domain/From authorization;
- provider policy state;
- traffic-share weight;
- per-second and per-minute limits;
- concurrency;
- provider daily/monthly capacity;
- account/domain/campaign capacity;
- cooldowns;
- adaptive slowdown;
- message capability requirements such as CID-inline transport.

With one eligible connection, EmailBlast simply uses that connection. With no eligible connection, pre-flight or runtime safety/capacity checks hold the work rather than bypassing restrictions.

## Background processing

Campaign creation does not keep the browser responsible for delivery.

PostgreSQL stores durable campaign, delivery, attempt, event, suppression, and audit state. Redis/BullMQ coordinates asynchronous delivery work and short-lived pacing/concurrency state.

The worker:

- prepares large campaign recipient sets in batches;
- queues deliveries when their scheduled time/capacity allows;
- processes transport work;
- recovers stalled claims;
- reconciles provider events;
- finalizes completed campaigns;
- emits its readiness heartbeat;
- refreshes adaptive provider pacing;
- performs selected provider re-checks;
- runs configured retention cleanup.

Closing the browser does not stop a campaign.

## Pacing and capacity

### Connection limits

Each provider connection can carry its own concurrency, per-second, per-minute, rolling daily, and monthly limits.

### Shared limits

Additional safeguards can constrain:

- the whole account;
- each sending domain;
- each campaign;
- each provider connection.

The effective pace is always the most restrictive currently applicable boundary.

### Adaptive provider slowdown

Configured rate limits are ceilings.

EmailBlast observes recent provider outcomes and can temporarily reduce effective connection speed or extend a cooldown when a provider shows pressure. The UI surfaces configured and effective rates separately.

### Domain soft-start

Higher-volume domains can use one of three ramp-up profiles:

- slow and cautious;
- balanced/recommended;
- faster while still within configured limits.

A new or recently idle domain starts below full pace and moves toward configured capacity as successful transport starts accumulate.

Soft-start never raises a provider or safety ceiling.

## Safety and suppression

### Do-not-send handling

The account-wide suppression list can be populated by:

- hard bounce;
- complaint;
- unsubscribe;
- manual operator block.

Suppression checks apply during import and again at delivery time so late changes are still enforced.

### Unsubscribe

Every campaign delivery gets a signed unsubscribe token.

Messages include one-click unsubscribe headers and a recipient unsubscribe URL. An unsubscribe creates/updates the account suppression and prevents pending/future work for that address.

### Automatic safety pauses

Complaint and hard-bounce thresholds can trigger protected sending pauses after the configured minimum sample size.

The configured brake scope can be:

- account;
- campaign;
- both.

A safety review requires explicit operator acknowledgement. Recording the review does **not** automatically resume the campaign; resume is a separate action.

Provider policy blocks are handled separately and cannot be cleared through an ordinary safety review.

## Link tracking

Click tracking is optional and off by default.

When enabled, eligible links are replaced with opaque redirect tokens under the installation's own `APP_URL`. No third-party shortener is required.

Analytics are intentionally aggregate:

- no recipient identity is stored with a visit;
- no visitor IP is stored;
- no browser fingerprint is stored;
- no analytics cookie is created;
- request headers are not retained;
- user-agent history is not retained;
- daily totals are aggregated by tracked link;
- obvious scanner/bot, HEAD, and prefetch traffic is counted separately as likely automated.

EmailBlast therefore does not claim that a tracked visit proves a human clicked.

Operators can maintain blocked destination domains and optionally reject campaign links whose destination reputation cannot be checked.

Tracking-link lifetime and aggregate retention are configurable.

## Activity and campaign control

Activity is the operational surface for campaigns.

It shows:

- campaign state and recipient counts;
- delivered/accepted/failed/remaining totals;
- bounce, complaint, unsubscribe, suppression, and unknown counts;
- live event updates;
- provider usage and availability;
- current campaign throughput;
- estimated remaining time when enough recent samples exist;
- sending-limit usage;
- click totals when enabled.

State-aware actions include:

- pause;
- resume;
- cancel remaining unstarted work;
- retry definitive failed recipients;
- CSV export;
- suppression search/manual block.

A retry does not touch already accepted or UNKNOWN deliveries.

Finished campaigns can be removed from the main Activity listing without deleting their underlying delivery history.

## Delivery events and reconciliation

Provider acceptance and mailbox delivery are different states.

Where supported, provider webhooks/events can move deliveries to:

- accepted;
- delivered;
- soft bounce;
- hard bounce;
- complaint;
- unsubscribe.

Webhook authentication is provider-specific. Events are stored and reconciled idempotently.

Hard bounces, complaints, and unsubscribes feed account suppression state.

Custom SMTP has no universal final-delivery event protocol; final delivery visibility depends on the SMTP service's event/webhook capabilities.

## Retention

Retention is configurable for operational data including:

- Activity events;
- selected old delivery attempts;
- processed provider/webhook events;
- click analytics;
- tracking-link lifetime;
- expired sessions;
- controlled-experiment evidence;
- controlled-experiment message snapshots.

Experiment message retention can scrub sensitive message content/attachments while preserving run and audit history.

For implementation-level state and locking boundaries, continue with [Architecture](ARCHITECTURE.md).
