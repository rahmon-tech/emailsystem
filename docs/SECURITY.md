# Security and operations

## Implemented controls

- Passwords use salted scrypt (N=32768, r=8, p=1), at least 12 characters. A server-side user creation command is provided; there is no public registration.
- Sessions store a keyed token hash, expire after seven days, and use HttpOnly, SameSite=Strict cookies, Secure in production. Login is throttled by account and client IP through Redis.
- Mutations require a matching Origin. Caddy overwrites X-Real-IP; only Caddy has published application ports.
- Every user-owned query includes its owner. Composite foreign keys bind imports, campaigns, deliveries and attempts to the correct owner. Tests cover cross-owner access and concurrent claims.
- Credentials use AES-256-GCM with a 32-byte environment key and owner/connection associated data. Browser responses select safe fields; secrets cannot be revealed. Replacing credentials increments a revision so late verification cannot activate a changed connection.
- Known provider endpoints are server-owned metadata. Custom SMTP DNS results must all be public unicast addresses. The chosen address is pinned while TLS verifies the original hostname. STARTTLS is required when implicit TLS is not selected. File/URL attachment resolution is disabled.
- SMTP has a 90-second overall deadline, including DNS and transfer, below its 120-second concurrency lease. Expiry destroys the TCP socket and records an unknown outcome; HTTP and SES requests are also bounded.
- HTML sanitization removes executable content, event attributes, forms, iframes, unsafe URLs and external CSS imports. Server-side normalization never downloads imported resources. Preview iframes have an empty sandbox and no referrer. Imported Outlook conditional blocks are removed with a visible warning; inspect client-specific layouts before sending.
- Upload sizes, XLSX expanded size/ZIP ratio, entry counts, row counts, attachment count and total bytes are bounded. Imports operate in batches.
- Webhooks use native signatures or explicit HTTPS credentials depending on provider. Raw payloads, provider keys and provider error bodies are never logged. Activity and audit store safe text and identifiers.
- CSV exports quote cells and prefix spreadsheet formula markers. Unsubscribe tokens are random and signed; GET only displays confirmation and POST performs suppression.

## Sending safety

Sending safety controls reduce accidental over-sending and help preserve provider/account health. They do not guarantee inbox placement or prevent provider restrictions. The controls cover independent rolling account/domain/provider/campaign budgets, recipient-copy costs, persistent UNKNOWN accounting and complaint/hard-bounce review pauses; [architecture](ARCHITECTURE.md#central-sending-safety-governor) defines the defaults and exact windows.

Safety mutations require an authenticated owner and matching Origin. Per-provider overrides and campaign review IDs are reauthorized inside the account transaction. Numeric bounds reject zero, negatives, fractional budgets and overflow; only campaign `null` explicitly disables a cap. The current model has one administrator per isolated user account, with no public registration or delegated roles. Acknowledging a review is an explicit administrative action, never an automatic recovery mechanism. Threshold edits cannot clear existing holds.

Reservations and restoration serialize under a PostgreSQL account advisory lock. All Redis safety state shares one key to fail closed after a flush/eviction. Loss after the durable transport-start marker remains charged, even when no response was saved. Deploy database migration and restart **all** web/worker instances together; workers running the previous version do not implement the new governor and must not coexist during rollout. Restore PostgreSQL and clear/rebuild stale Redis safety state after a database backup restore.

Outcome brakes depend on authenticated, correlated provider events and accepted history; absence of webhooks is not evidence of a healthy complaint rate. Known suppressed recipients are excluded before claims and from prior-accepted outcome cohorts. Seven-day outcome evidence fits the minimum seven-day normalized-event retention. Provider policy enforcement remains a separate block and must be resolved before safety review/resume.

## Operational boundaries

Use consented lists and authenticated sending domains. Explicit policy enforcement pauses sending; review the account before re-verifying the blocked connection. Re-verification cannot replace a provider's approval.

Provider acceptance is not proof of inbox delivery. Custom SMTP has no generic delivery webhook. Configure a supported provider's webhook to obtain confirmed delivery states for API or SMTP sends where IDs can be correlated. Some providers rewrite SMTP message IDs; test your account's event payloads before relying on automated reconciliation.

Keep the same encryption key when restoring backups. Losing it makes stored provider credentials unrecoverable. Key rotation requires a controlled decrypt/re-encrypt migration while both keys are available; it is not implemented as a UI operation. Session secret rotation invalidates sessions and existing unsubscribe signatures; keep it stable and treat a rotation as an operational migration.

Remote email images are displayed by the recipient/browser and may track views. The server does not fetch them. Preview scripts and forms remain disabled. Attachments are size-limited, but there is no antivirus scanning service bundled with this application.

The Compose bridge allows outbound internet access for providers. PostgreSQL and Redis have no published ports; do not expose them. Restrict access from untrusted containers on the host. App containers run as the unprivileged node user with capabilities dropped. Add host egress filtering for defense in depth around custom SMTP.

## Review evidence

Automated checks include encrypted credential tampering/AAD binding, password hashing, unsubscribe forgery, formula injection, HTML isolation, signature/replay checks, bounded retry rules, tenant boundaries and concurrent lifecycle tests. Review GitHub Actions and CURRENT_WORK for the actual executed gates. Automated mocks do not establish live-provider permissions or deployment security for an unseen VPS.
# Tracking privacy and HTML acceptance

Click tracking is optional and off by default. Redirect records are account/campaign scoped with composite owner foreign keys; opaque tokens contain no email address, recipient ID or destination. Tokens are shared at the campaign/link level to avoid individual profiling. A visit does not authenticate a recipient or prove human engagement and never changes delivery state. Scanner labels are explicitly heuristic; ordinary requests stay unclassified.

The tracking service stores no IP addresses, raw user agents, browser/device fingerprints, cookies, referrers or unrelated request headers. It inspects a bounded user-agent string and prefetch hints only in memory. The stored visit data is a UTC day, owner/link IDs and aggregate counters. `CLICK_ANALYTICS_RETENTION_DAYS` defaults to 90 (configurable 1–365); the hourly worker cleanup deletes older totals. `TRACKING_LINK_LIFETIME_DAYS` defaults to 180 (1–730); expired redirect records and their visit totals are deleted and old links return unavailable. Campaign message snapshots follow the existing campaign/backup lifecycle and contain the already-sent opaque URLs. Backup operators must apply their own bounded backup expiry. Proxy access logs for tracking must be disabled or minimize/expire their data as described in deployment instructions; the provided Nginx fragment disables them.

The redirect accepts only server-stored HTTP(S) destinations and its assigned verified hostname. Disabled, expired or locally blocked links fail closed; a query-string URL cannot override the destination. No destination fetching occurs in HTML normalization or the local reputation source. Hostname verification uses owned DNS TXT proof, public-address validation, DNS pinning, validated TLS, a bounded response/deadline and no redirect following. Account APIs retain existing session, CSRF, mutation-rate and owner checks. Automatic re-verification cannot undo a concurrent disable.

The renderer permits supported email HTML and safe Outlook ghost tables/VML buttons after sanitizing each fallback. It removes active content/unsafe CSS, exposes resulting changes in pre-flight and preserves legitimate copy, visual structure and responsive CSS. It does not randomize markup, alter subjects, insert filler, conceal destinations to evade reputation checks or optimize content to defeat spam filters. The fidelity fixtures test structural hierarchy, CTA/text/image placement, dimensions, spacing, media queries, button styling and supported Outlook fallbacks. Browser screenshots compare normalized and original templates at 390/1366 pixels. Chromium cannot prove actual Outlook rendering; live Outlook acceptance remains an environment-specific check.
