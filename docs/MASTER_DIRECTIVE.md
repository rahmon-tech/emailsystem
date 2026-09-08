# EMAILSYSTEM — MASTER PRODUCT, ARCHITECTURE & ENGINEERING DIRECTIVE

## PROJECT

Repository:

GitHub repository `rahmon-tech/emailsystem`

You are the principal/senior engineer responsible for taking this repository from its ACTUAL PRESENT STATE to a polished, production-ready, self-hosted multi-provider email campaign platform.

This is a real client deliverable.

Do not treat it as:

- a demo;
- proof of concept;
- UI prototype;
- weekend project;
- set of mocked screens.

The delivered application must genuinely work end-to-end.

Your responsibility is:

**inspect → understand → design → implement → test → review → secure → document → deploy-ready → commit → verify.**

Do not merely create a plan.

Perform the work.

Do not stop after scaffolding.

Do not stop after UI.

Do not leave important controls as fake buttons.

Do not report fake delivery statistics.

Do not create fake providers in production.

Do not leave core requirements as TODOs.

When third-party credentials are unavailable, implement the complete adapter against documented provider behavior and use deterministic mocks/test adapters for automated verification.

---

# 1. FIRST ESTABLISH REPOSITORY TRUTH

Before modifying anything:

Inspect:

- current branch;
- remote;
- recent commits;
- working tree;
- package manager;
- framework;
- source structure;
- database;
- schema/migrations;
- tests;
- CI;
- deployment files;
- environment configuration;
- README;
- existing documentation.

Determine whether the repository is:

1. empty;
2. partially implemented;
3. already contains usable architecture.

Preserve correct existing work.

Do not blindly replace an existing good architecture because this directive suggests another approach.

Never destroy unrelated user work.

Never commit secrets.

Create/update:

`docs/CURRENT_WORK.md`

It should contain:

- current verified repository state;
- completed milestones;
- remaining milestones;
- architectural decisions that materially affect continuation;
- latest verified commit.

Use repository truth instead of assumptions.

---

# 2. PRODUCT DEFINITION

Build a self-hosted multi-provider email campaign/orchestration application.

The user should experience the product primarily as:

**Providers → Blast → Activity**

These are the THREE primary product navigation sections.

Secondary functionality such as:

- account;
- profile;
- security;
- logout;

may exist behind an account menu.

Do not clutter primary navigation.

---

# 3. CORE USER EXPERIENCE

A normal user should be able to:

1. Sign in.
2. Go to Providers.
3. Select Resend, SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO, Elastic Email, or Custom SMTP.
4. Enter credentials.
5. Click `Save & Verify`.
6. Have EmailSystem automatically test the credentials.
7. See whether the connection is healthy.
8. Upload recipients.
9. Compose or import an HTML email.
10. Preview it.
11. Run pre-flight validation.
12. Press Send.
13. Leave the browser.
14. Let the VPS continue sending through background workers.
15. Return to Activity.
16. Watch progress and final delivery state.
17. Pause/resume/cancel when permitted.
18. Export results.

The complexity belongs in the backend.

The user should not have to understand API endpoint URLs, SMTP ports, queue workers, Redis, retry algorithms or provider SDK differences.

---

# 4. ENGINEERING STACK

Remain TypeScript-first.

If repository truth permits, use:

## Monorepo / workspace

Prefer `pnpm` workspaces if starting fresh.

Potential structure:

```text
apps/
  web/
  worker/

packages/
  core/
  db/
  providers/
  email-renderer/
  queue/
  config/
  testing/
```

Do not create packages without meaningful boundaries.

## Web

- TypeScript
- React
- Next.js
- MUI

Use current stable mutually compatible versions.

## Database

- PostgreSQL
- Prisma

## Background processing

- Redis
- BullMQ

## SMTP

- Nodemailer

## Validation

- Zod

## Email processing

Evaluate mature libraries including:

- Tiptap
- CodeMirror or Monaco
- MJML
- juice
- sanitize-html
- html-to-text
- xlsx

Use only what provides real value.

## Live Activity

Prefer Server-Sent Events unless WebSockets have a concrete advantage.

## Production deployment

- Docker
- Docker Compose
- Caddy or equivalent reverse proxy
- PostgreSQL
- Redis
- Web application
- Worker

---

# 5. ARCHITECTURAL BOUNDARIES

Prefer meaningful deep modules.

Recommended conceptual modules:

```text
auth
users
providers
provider-health
imports
composer
campaigns
deliveries
dispatcher
queue
webhooks
suppressions
activity
audit
```

Business logic must not live primarily inside React components.

Provider-specific SDK code must not leak into campaigns or Activity.

Centralize:

- campaign transitions;
- delivery transitions;
- retry rules;
- provider health;
- dispatcher selection;
- suppression checks.

---

# 6. BUILT-IN PROVIDER CATALOG — CRITICAL

EmailSystem must contain a built-in provider catalog.

For known providers, the USER SHOULD NOT TYPE API ENDPOINTS OR SMTP HOSTS MANUALLY.

The provider catalog owns:

- API host;
- API path;
- authentication style;
- SMTP hostname;
- default ports;
- TLS requirements;
- credential fields;
- region options;
- capabilities;
- webhook capabilities;
- test strategy;
- signup/help domain.

Store this as typed application metadata.

Conceptually:

```ts
interface ProviderDefinition {
  id: ProviderType;
  displayName: string;
  websiteDomain: string;
  supportedTransports: ("api" | "smtp")[];
  api?: ApiDefinition;
  smtp?: SmtpDefinition;
  capabilities: ProviderCapabilities;
}
```

Built-in endpoints must normally be read-only.

Do not expose endpoint editing in the basic UI.

If debugging requires endpoint overriding, hide it behind an explicit development/advanced configuration and do not allow silent production overrides.

Custom SMTP is the intentional escape hatch for arbitrary SMTP infrastructure.

---

# 7. RESEND PRESET

Official service:

`resend.com`

Support:

- API
- SMTP

## API defaults

Scheme:

`https`

Host:

`api.resend.com`

Send path:

`/emails`

Authentication:

Bearer API key.

Fields shown to user:

- Connection name
- API key
- From email
- From name
- Reply-To
- Optional sending domain
- Weight
- Rate configuration

Do NOT ask user for API URL.

## SMTP defaults

Host:

`smtp.resend.com`

Username:

literal value:

`resend`

Password:

Resend API key.

Supported ports:

- 465 implicit TLS
- 2465 implicit TLS
- 25 STARTTLS
- 587 STARTTLS
- 2587 STARTTLS

Default recommendation:

465 or 587.

Do not ask user for SMTP hostname.

## Resend verification

Implement provider-aware test logic.

For full-access keys, use a harmless read request such as domain discovery where permission permits.

For send-only keys, support Resend's safe test recipient:

`delivered@resend.dev`

Use a unique idempotency key.

Do not confuse failed read permission with invalid sending credentials.

Distinguish:

- authentication failure;
- key lacks read permission;
- sending permission available;
- domain not verified;
- network failure.

Resend also supports test addresses that simulate delivery/bounce/complaint events. Use them in integration documentation and optional provider integration tests.

---

# 8. MAILGUN PRESET

Official service:

`mailgun.com`

Support:

- API
- SMTP

Mailgun requires a sending domain.

## API defaults

US host:

`api.mailgun.net`

EU host:

`api.eu.mailgun.net`

Path pattern:

`/v3/{domain}/messages`

User selects:

- US
- EU

Authentication:

HTTP Basic.

Username:

`api`

Password:

API key.

Fields:

- Connection name
- Region
- API key
- Mailgun domain
- From email
- From name
- Reply-To
- Weight
- Rate settings

Do not ask for endpoint.

## SMTP defaults

Host:

`smtp.mailgun.org`

Ports:

- 587 STARTTLS — recommended
- 25 STARTTLS
- 2525 STARTTLS
- 465 implicit TLS

Credentials are Mailgun domain-specific SMTP username/password.

## Verification

First attempt non-destructive domain/account verification where the API key permits it.

Verify:

- authentication;
- domain exists;
- region matches domain;
- domain status where exposed.

Mailgun offers test mode through `o:testmode=yes`.

That mode processes without actual recipient delivery, but it may be billable.

Therefore:

DO NOT silently run a billable Mailgun test on every save.

If a harmless read check cannot prove send permission, show:

`Credentials authenticated; send capability requires test send.`

Provide:

`Run Mailgun Test`

with explicit UI indication if provider billing may apply.

---

# 9. AMAZON SES PRESET

Official service:

`aws.amazon.com/ses`

Support:

- API
- SMTP

Use the official AWS SDK for JavaScript v3 for API sending.

Do not make users construct AWS endpoints.

## API fields

- Connection name
- AWS region
- Access Key ID
- Secret Access Key
- Optional Session Token
- From email
- From name
- Reply-To
- Weight

Populate a region selector from supported SES regions.

The AWS SDK resolves the service endpoint.

## API verification

Use SES v2 `GetAccount`.

Extract useful account information such as:

- SendingEnabled
- ProductionAccessEnabled
- EnforcementStatus
- SendQuota
- MaxSendRate where available.

Display clearly if the account is still in SES sandbox.

An account being in sandbox is NOT the same as invalid credentials.

Statuses might include:

`HEALTHY — SANDBOX`

or:

`HEALTHY — PRODUCTION`

## SMTP mode

Hostname pattern:

`email-smtp.{region}.amazonaws.com`

Generate automatically from region.

Ports:

STARTTLS:
- 25
- 587
- 2587

Implicit TLS:
- 465
- 2465

Prefer:

587.

SES SMTP credentials differ from ordinary AWS access credentials.

Make this explicit in the form.

## Testing

SMTP:

Use Nodemailer `verify()`.

API:

Use `GetAccount`.

Optional controlled delivery tests may use the AWS SES mailbox simulator.

Never require a real external recipient merely to check credentials.

---

# 10. TWILIO SENDGRID PRESET

Official service:

`sendgrid.com`

Support:

- API
- SMTP

## API

Global host:

`api.sendgrid.com`

Base path:

`/v3`

Send path:

`/v3/mail/send`

Authentication:

Bearer API key.

For supported EU regional accounts/subusers, account for the documented regional API host rather than hard-coding global assumptions.

Fields:

- Connection name
- Region/mode where applicable
- API key
- From email
- From name
- Reply-To
- Weight
- Rate limit

## Credential test

Call:

`GET /v3/scopes`

using the entered API key.

Require or detect:

`mail.send`

If authentication succeeds but `mail.send` is absent:

status:

`MISSING SEND PERMISSION`

Do not call the key invalid.

## SMTP

Host:

`smtp.sendgrid.net`

Username:

literal:

`apikey`

Password:

actual SendGrid API key.

Ports:

- 587 STARTTLS — preferred
- 2525 STARTTLS
- 25 STARTTLS
- 465 implicit TLS

SMTP connection test:

Nodemailer `verify()`.

---

# 11. BREVO PRESET

Official service:

`brevo.com`

Support:

- API
- SMTP

## API

Host:

`api.brevo.com`

Send path:

`/v3/smtp/email`

Authentication header:

`api-key`

Fields:

- Connection name
- API key
- From email
- From name
- Reply-To
- Weight

## API credential verification

Use:

`GET /v3/account`

This is the preferred Save & Verify check.

Use the response to display useful information where available:

- account identity;
- plan;
- credits;
- transactional relay state.

## SMTP

Host:

`smtp-relay.brevo.com`

Use Brevo SMTP credentials.

IMPORTANT:

SMTP password must be the Brevo SMTP key, NOT necessarily the API key.

Fields:

- SMTP login
- SMTP key

Ports commonly supported:

- 587
- 2525
- 465

Default:

587 STARTTLS.

---

# 12. POSTMARK PRESET

Official service:

`postmarkapp.com`

Support:

- API
- SMTP

Bulk/blast mail must respect Postmark's separation between transactional and broadcast streams.

For EmailSystem campaigns, prefer a **Broadcast Message Stream** where the email qualifies as broadcast mail.

## API

Host:

`api.postmarkapp.com`

Send path:

`/email`

Authentication header:

`X-Postmark-Server-Token`

Fields:

- Connection name
- Server token
- Message Stream
- From email
- From name
- Reply-To
- Weight

Default campaign stream intent:

Broadcast.

Do not silently use a transactional stream for bulk marketing-style campaigns.

## Credential verification

Use the REAL entered server token with:

`GET /server`

This checks the actual credential.

Do not use `POSTMARK_API_TEST` to claim the user's real token works.

Postmark's special `POSTMARK_API_TEST` token can be used in application development/tests to validate payload structures without delivering real mail.

## SMTP

Transactional host:

`smtp.postmarkapp.com`

Broadcast host:

`smtp-broadcasts.postmarkapp.com`

EmailSystem blast campaigns should normally use the broadcast SMTP host when appropriate.

Ports:

- 25
- 2525
- 587

Use STARTTLS.

Provide a message-stream-aware UI.

---

# 13. MAILJET PRESET

Official service:

`mailjet.com`

Support:

- API
- SMTP

## API

Host:

`api.mailjet.com`

Send path:

`/v3.1/send`

Authentication:

HTTP Basic.

Username:

Mailjet API key.

Password:

Mailjet Secret key.

Fields:

- Connection name
- API key
- Secret key
- From address
- From name
- Reply-To
- Weight

## Save & Verify

Mailjet provides Sandbox Mode.

Use a correctly structured Send API request with:

`SandboxMode: true`

This runs payload validation without delivering the message.

This is ideal for provider verification.

Do not require actual mailbox delivery merely to validate Mailjet credentials/configuration.

## SMTP

Host:

`in-v3.mailjet.com`

Username:

API key.

Password:

Secret key.

Preferred:

587 with TLS/STARTTLS.

Also support:

465 with implicit TLS.

---

# 14. SMTP2GO PRESET

Official service:

`smtp2go.com`

Support:

- API
- SMTP

## API

Global host:

`api.smtp2go.com`

Base path:

`/v3`

Send path:

`/v3/email/send`

Authentication header:

`X-Smtp2go-Api-Key`

Regional hosts also exist.

Support optional region selection:

- Global
- US
- EU
- AU

Do not require the user to know regional URLs.

## Credential test

Use a harmless authenticated statistics/account-style request where permissions permit, for example the email summary statistics endpoint.

If the key only has send permission and lacks read permission:

do not incorrectly classify it as invalid.

Offer controlled test-send verification.

## SMTP

Host:

`mail.smtp2go.com`

Default port:

2525.

Available TLS/no-encryption ports include:

- 25
- 2525
- 8025
- 587
- 80

SSL ports include:

- 465
- 8465
- 443

Prefer:

2525 STARTTLS or 587 STARTTLS.

Fields:

- SMTP username
- SMTP password

---

# 15. ELASTIC EMAIL PRESET

Official service:

`elasticemail.com`

Support:

- API
- SMTP

## API

Host:

`api.elasticemail.com`

Base:

`/v4`

Email send endpoint should use the appropriate v4 email endpoint.

Authentication:

Elastic Email API key/access token.

Fields:

- Connection name
- API key
- From email
- From name
- Reply-To
- Weight

## Verification

Where key permissions allow, perform a harmless read such as domain/account information.

Do not classify a send-only key as invalid merely because a read scope is unavailable.

If necessary, offer controlled user-authorized test sending.

## SMTP

Host:

`smtp.elasticemail.com`

Ports:

- 25
- 2525
- 587
- 465

Prefer:

587 STARTTLS or 465 SSL.

Elastic Email supports multiple SMTP credentials.

Allow multiple Elastic Email SMTP connections independently.

---

# 16. GENERIC CUSTOM SMTP

Provide:

`Custom SMTP`

Fields:

- Connection name
- Host
- Port
- Username
- Password
- Security mode:
  - STARTTLS
  - Implicit TLS
- Connection timeout
- From address
- From name
- Reply-To
- Rate limit
- Concurrency
- Weight

Avoid insecure defaults.

Do not disable certificate verification by default.

Use Nodemailer.

---

# 17. ADD PROVIDER UX

The Providers page must begin with provider cards/logos.

Example:

```text
Add sending provider

[ Resend ]      [ Amazon SES ]
[ Mailgun ]     [ SendGrid ]
[ Brevo ]       [ Postmark ]
[ Mailjet ]     [ SMTP2GO ]
[ Elastic ]     [ Custom SMTP ]
```

When a known provider is selected:

1. select API or SMTP if both are supported;
2. render only fields relevant to that provider;
3. silently apply official host/path/port defaults;
4. explain where credentials are obtained;
5. save credentials encrypted;
6. verify connection.

Normal users should never need to Google an SMTP hostname while configuring a built-in provider.

---

# 18. SAVE & VERIFY PROVIDER — HIGH PRIORITY

Every provider form must have:

`Save & Verify`

and optionally:

`Save Unverified`

The normal path is `Save & Verify`.

Verification pipeline:

```text
Validate form
    ↓
Normalize configuration
    ↓
Encrypt credentials
    ↓
Attempt provider-specific authentication
    ↓
Validate capability
    ↓
Validate sender/domain where possible
    ↓
Record test result
    ↓
HEALTHY / ACTION REQUIRED
```

A provider cannot enter the active dispatcher pool until verification succeeds sufficiently for sending.

Possible states:

```text
UNVERIFIED
TESTING
HEALTHY
DEGRADED
THROTTLED
COOLDOWN
AUTH_ERROR
MISSING_PERMISSION
SENDER_UNVERIFIED
DOMAIN_UNVERIFIED
SANDBOX
POLICY_BLOCKED
DISABLED
CONFIG_ERROR
```

Store last verification timestamp.

---

# 19. PROVIDER TEST RESULTS

After testing, show a detailed but understandable result.

Example:

```text
Resend Primary

Connection             PASSED
Authentication         PASSED
Send permission        PASSED
Sending domain         VERIFIED
SMTP/API connectivity  PASSED

Status: HEALTHY
Last checked: 19:42
```

Or:

```text
SendGrid Main

Authentication         PASSED
Mail send permission   FAILED

Required scope:
mail.send

Status: ACTION REQUIRED
```

Never expose credentials in errors.

---

# 20. TEST EMAIL AFTER PROVIDER SETUP

In addition to credential verification, allow:

`Send Test Email`

The user enters a test recipient.

The system sends a tiny controlled email through that exact connection.

Record it as:

`ProviderTestDelivery`

NOT as a campaign delivery.

Show:

- provider;
- accepted/rejected;
- provider message ID;
- safe error;
- timestamp.

Use provider-native non-delivery test mechanisms whenever appropriate.

---

# 21. PROVIDER CREDENTIAL SECURITY

Provider credentials must be encrypted at rest.

Use authenticated encryption such as:

AES-256-GCM.

Master encryption key comes from environment configuration.

Store:

- encrypted bytes;
- IV/nonce;
- authentication tag;
- key version if appropriate.

Never return decrypted credentials to the browser after creation.

UI displays:

`••••••••••9F3A`

Allow:

`Replace credential`

not:

`Reveal credential`.

Never log provider secrets.

---

# 22. PROVIDER ABSTRACTION

Every provider implements a stable contract.

Conceptually:

```ts
interface EmailProviderAdapter {
  verify(
    connection: DecryptedProviderConnection
  ): Promise<ProviderVerificationResult>;

  send(
    context: DeliveryContext,
    message: ProviderMessage
  ): Promise<ProviderSendResult>;

  normalizeError(
    error: unknown
  ): ProviderError;

  capabilities(): ProviderCapabilities;
}
```

Normalized send result:

```ts
type ProviderSendResult = {
  status: "accepted" | "rejected" | "unknown";
  providerMessageId?: string;
  acceptedAt?: Date;
  metadata?: Record<string, unknown>;
};
```

Normalized error:

```ts
type ProviderErrorCategory =
  | "temporary"
  | "permanent"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "policy"
  | "sender_configuration"
  | "unknown";
```

Provider SDK objects must not leak into domain/UI state.

---

# 23. PROVIDERS PAGE LIST

Each provider connection card should display:

- provider logo/name;
- connection name;
- API/SMTP;
- sending identity;
- health;
- last verified;
- recent success percentage;
- active/inactive;
- configured weight.

Actions:

- Test
- Edit
- Disable
- Delete

Do not show secrets.

---

# 24. BLAST PAGE

Core sections:

```text
Recipients
Message
Preview
Pre-flight
Send
```

Keep the UI focused.

---

# 25. CONTACT IMPORT

Support:

- CSV
- TXT
- XLSX
- manual paste

Only mandatory field:

`email`

Automatically detect email column.

Normalize addresses.

Report:

- rows;
- valid;
- invalid;
- duplicate;
- suppressed;
- final sendable.

Remove duplicates within a campaign.

Large files must not freeze the browser.

Use server-side streaming/batching where appropriate.

Never create one enormous browser payload.

---

# 26. EMAIL COMPOSER

Fields:

- Campaign name
- From name
- From email
- Reply-To
- Subject
- Preheader/preview text
- CC
- BCC
- Body
- Plain-text fallback
- Optional attachments
- Optional schedule
- Optional tags

Recipients themselves are individual deliveries.

Never expose recipient A to recipient B through To/CC fields.

---

# 27. RICH TEXT EDITOR

Provide a polished toolbar:

- bold;
- italic;
- underline;
- strikethrough;
- headings;
- lists;
- alignment;
- link;
- button;
- image;
- divider;
- blockquote;
- colors where safe;
- undo/redo.

Use a mature editor such as Tiptap where appropriate.

---

# 28. HTML IMPORTER — VERY HIGH PRIORITY

Users can:

- paste HTML;
- upload `.html`;
- switch to source mode;
- edit;
- preview;
- send.

Do NOT make the dangerous mistake of automatically converting arbitrary imported HTML into MJML if that conversion causes loss.

Use MJML for EmailSystem-generated structures if useful.

Preserve imported HTML as HTML through a controlled pipeline.

Recommended pipeline:

```text
Raw HTML
  ↓
Parse
  ↓
Security sanitization
  ↓
Email compatibility normalization
  ↓
CSS handling / inlining
  ↓
Validate links/images
  ↓
Plain-text generation
  ↓
Store immutable snapshot
  ↓
Preview / Send
```

Remove:

- scripts;
- inline event handlers;
- unsafe iframes;
- dangerous forms;
- javascript URLs;
- executable content.

Preserve legitimate email structures such as:

- tables;
- nested tables;
- inline CSS;
- widths;
- Outlook conditional comments where safely supportable;
- media queries where appropriate;
- images;
- buttons.

Use a sandboxed iframe for preview.

---

# 29. EMAIL PREVIEW

Modes:

- Desktop
- Mobile
- Plain text
- HTML source

Mobile approximately modern phone width.

Preview must render the SAME normalized HTML snapshot that sending uses.

Do not maintain a fake preview renderer different from send output.

---

# 30. CAMPAIGN PRE-FLIGHT

Before send:

Check:

- recipients;
- suppression filtering;
- subject;
- body;
- from;
- reply-to;
- healthy providers;
- sender compatibility;
- HTML;
- plain text;
- unsubscribe support where required.

Example:

```text
READY TO SEND

28,491 recipients
412 duplicates removed
38 suppressed

5 verified providers
4 healthy
1 unavailable

HTML valid
Plain text generated
Reply-To valid
Unsubscribe ready
```

---

# 31. DURABLE CAMPAIGN MODEL

Clicking Send must NOT send email synchronously.

Instead:

1. validate;
2. create immutable message snapshot;
3. persist campaign;
4. persist recipients;
5. create logical deliveries;
6. enqueue work;
7. return UI immediately.

Browser closure must not stop anything.

---

# 32. QUEUE

Use BullMQ + Redis.

Never use one huge job for all recipients.

Model one logical delivery per campaign recipient.

Batch queue insertion efficiently.

Workers independently process delivery jobs.

---

# 33. SMART DISPATCHER

Provider selection must not be naive round robin only.

Consider:

- enabled;
- verified;
- current health;
- transport;
- configured weight;
- configured rate;
- current load;
- cooldown;
- temporary-error rate;
- sender compatibility;
- provider quota;
- concurrent tasks.

Use weighted fair selection.

Example:

```text
SES Primary      35
Mailgun Main     20
Resend #1        20
Resend #2        15
SMTP2GO          10
```

This means desired workload share, not enforcement evasion.

---

# 34. RATE LIMITING

Respect provider limits.

Also permit user-defined conservative limits.

Coordinate limits through Redis so multiple workers cannot bypass limits.

Support:

- concurrency limits;
- per-second limits;
- per-minute limits;
- cooldown.

Do not rely solely on process-local counters.

---

# 35. RETRIES

Classify failures.

Temporary:

- 429;
- network timeout;
- temporary SMTP code;
- provider 5xx;
- temporary outage.

Permanent:

- invalid address;
- hard bounce;
- invalid sender;
- permanent rejection.

Ambiguous/unknown:

provider may have accepted the request but response was lost.

Use exponential backoff + jitter.

Bound attempts.

Never infinite-retry.

---

# 36. DUPLICATE PROTECTION

Critical.

Persist:

- campaignId;
- recipientId;
- deliveryId;
- attemptId;
- providerConnectionId;
- providerMessageId;
- idempotencyKey.

Use unique constraints.

Use provider-native idempotency where supported.

An HTTP timeout after sending does NOT automatically mean "try another provider."

Unknown sends enter reconciliation state.

Do not create duplicate recipient delivery simply because a provider response was lost.

---

# 37. CAMPAIGN STATES

Central domain enum:

```text
DRAFT
PREPARING
QUEUED
SENDING
PAUSED
CANCELLING
CANCELLED
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
```

Define legal transitions centrally.

---

# 38. DELIVERY STATES

Use:

```text
PENDING
QUEUED
PROCESSING
PROVIDER_ACCEPTED
DELIVERED
DEFERRED
SOFT_BOUNCED
HARD_BOUNCED
FAILED
COMPLAINED
UNSUBSCRIBED
SUPPRESSED
CANCELLED
UNKNOWN
```

Provider accepted is NOT delivered.

---

# 39. WEBHOOKS

Implement provider-specific webhook handlers where supported.

Handlers must:

- verify signatures;
- authenticate properly;
- be idempotent;
- store normalized event;
- associate event with delivery;
- tolerate duplicate webhooks.

Normalize:

- accepted;
- delivered;
- deferred;
- bounce;
- complaint;
- open;
- click;
- unsubscribe.

Use provider event IDs/message IDs for deduplication.

---

# 40. SUPPRESSION SYSTEM

Global suppression reasons:

- hard bounce;
- complaint;
- unsubscribe;
- manually suppressed;
- invalid;
- provider suppression where appropriate.

Before delivery:

check suppression.

Never repeatedly send to known hard bounces/complaints.

Provide suppression inspection.

---

# 41. UNSUBSCRIBE

Implement:

- signed unsubscribe tokens;
- unsubscribe landing endpoint;
- suppression;
- List-Unsubscribe;
- List-Unsubscribe-Post where appropriate.

Do not expose guessable internal IDs.

---

# 42. ACTIVITY PAGE

Activity is the campaign operations centre.

Campaign overview:

```text
Campaign               September Outreach

Status                 SENDING

Recipients             48,293
Queued                 31,842
Processing                  7
Provider accepted      15,917
Delivered              14,988
Deferred                  226
Bounced                   119
Failed                     61
Suppressed                 44
```

Use database truth.

---

# 43. LIVE ACTIVITY FEED

Create a polished terminal-inspired live event stream.

Example:

```text
19:14:31  SES Main      jo•••@gmail.com      ACCEPTED
19:14:31  Mailgun       ma•••@outlook.com    ACCEPTED
19:14:32  Resend #2     te•••@yahoo.com      RETRY 45s
19:14:32  SES Main      ka•••@gmail.com      DELIVERED
```

Mask addresses by default.

Never display provider passwords/API keys.

Use cursor-based SSE reconnection so temporary browser disconnects do not lose truth.

---

# 44. PAUSE / RESUME / CANCEL

Must be real end-to-end controls.

Pause:

stop claiming NEW eligible work.

Do not corrupt currently executing attempts.

Resume:

resume durable remaining queue.

Cancel:

cancel eligible unclaimed deliveries.

Do not falsely mark already provider-accepted deliveries as cancelled.

Protect race conditions.

---

# 45. CAMPAIGN EXPORT

CSV export.

Columns may include:

- email;
- final status;
- provider;
- provider message ID;
- attempts;
- accepted timestamp;
- delivered timestamp;
- bounce;
- safe failure reason.

Prevent CSV formula injection.

---

# 46. AUTHENTICATION & OWNERSHIP

Implement:

- login;
- logout;
- password hashing;
- sessions;
- protected routes;
- login throttling.

Use Argon2id or equivalent.

Every user-owned record must be scoped correctly.

User A must never see User B:

- providers;
- credentials;
- imports;
- campaigns;
- activity.

Do not rely solely on frontend filtering.

---

# 47. DATABASE CONCEPTS

Expected concepts:

```text
User
Session

ProviderConnection
ProviderVerification
ProviderHealthSnapshot

Import
ImportRecipient

Campaign
CampaignMessageSnapshot
CampaignRecipient

Delivery
DeliveryAttempt

ProviderEvent
Suppression

AuditEvent
```

Design actual Prisma schema based on domain behavior.

Important uniqueness may include:

```text
campaign + normalized recipient
provider + provider event ID
delivery logical identity
```

Add appropriate indexes.

---

# 48. SECURITY

Perform a serious security review.

Address:

- encrypted credentials;
- XSS;
- HTML import;
- preview isolation;
- authentication;
- authorization;
- CSRF;
- SSRF;
- unsafe redirects;
- path traversal;
- file upload abuse;
- webhook spoofing;
- CSV injection;
- logs;
- secret leakage;
- rate limiting;
- IDOR;
- cross-user access.

Provider test endpoints must not become SSRF endpoints.

Built-in endpoints are server-owned constants.

Custom SMTP host input needs validation and appropriate network-security consideration.

---

# 49. TESTING STRATEGY

Tests are mandatory.

## Provider tests

For EVERY built-in provider:

Test:

1. schema validation;
2. correct built-in endpoint selection;
3. auth construction;
4. sender mapping;
5. HTML/text mapping;
6. CC/BCC/Reply-To mapping;
7. provider message ID extraction;
8. temporary error classification;
9. permanent error classification;
10. rate-limit classification;
11. authentication failure;
12. safe error redaction;
13. verification behavior.

No automated test sends real email.

Mock HTTP/SDK/SMTP.

## Provider onboarding tests

Verify:

- valid credential test -> healthy;
- invalid credentials -> auth error;
- read permission absent but send permission possible -> not misclassified;
- unverified sender -> action required;
- API endpoint is preconfigured;
- SMTP hostname is preconfigured;
- credentials never returned from API.

## Dispatcher tests

Verify:

- disabled excluded;
- unverified excluded;
- cooldown excluded;
- weights work;
- fairness works;
- rate limits respected;
- health recovery works.

## Campaign tests

Verify:

- import;
- deduplication;
- suppression;
- queue creation;
- retry;
- pause;
- resume;
- cancellation;
- webhook updates;
- duplicate webhook;
- ambiguous send handling.

## Race tests

Cover:

- two workers claiming;
- cancel vs claim;
- webhook vs retry;
- duplicate start;
- provider response vs timeout.

## UI tests

Cover:

- login;
- add provider;
- Save & Verify;
- failed provider validation;
- upload recipients;
- compose;
- import HTML;
- mobile preview;
- desktop preview;
- test send;
- pre-flight;
- start;
- Activity;
- pause;
- resume;
- cancel.

---

# 50. MOCK PROVIDER

Implement a development-only MockProvider.

Modes:

- success;
- delay;
- temporary failure;
- permanent failure;
- rate limit;
- ambiguous response;
- bounce webhook;
- delivered webhook.

Use this to demonstrate the complete application without real credentials.

MockProvider must be disabled in production unless explicitly enabled.

---

# 51. RESPONSIVE UI

Test around:

- 390px;
- 430px;
- tablet;
- 1366px;
- large desktop.

Provider tables should adapt into cards on mobile.

Composer must remain usable.

Activity log must not break width.

Use MUI well.

Avoid unnecessary borders everywhere.

Use:

- skeletons;
- empty states;
- toasts;
- responsive dialogs;
- meaningful typography;
- good spacing.

---

# 52. FRESH USER EXPERIENCE

A new user sees ZERO fake data.

Providers:

`No providers configured yet.`

Blast:

`Add and verify at least one provider before sending.`

Activity:

`Your campaigns will appear here.`

---

# 53. OBSERVABILITY

Structured logs.

Include:

- campaign ID;
- delivery ID;
- attempt ID;
- provider connection ID.

Never include credential values.

Health endpoints:

```text
/health/live
/health/ready
```

Readiness should reflect PostgreSQL and Redis availability appropriately.

---

# 54. WORKER RELIABILITY

Workers must support:

- graceful shutdown;
- bounded concurrency;
- durable jobs;
- restart recovery;
- stalled job recovery;
- safe claim semantics;
- memory-conscious batches.

Frontend/web process restarting must not lose work.

---

# 55. DATA RETENTION

Prevent unbounded database growth.

Provide configurable retention for:

- verbose Activity events;
- webhook payload;
- attempts;
- old queue data.

Do not delete campaign summary truth accidentally.

---

# 56. AUDIT EVENTS

Record important operations:

- provider created;
- provider verified;
- provider credential changed;
- provider disabled;
- campaign started;
- campaign paused;
- campaign resumed;
- campaign cancelled.

Never audit secret plaintext.

---

# 57. CI

Configure GitHub Actions if absent.

CI:

```text
install
lint
typecheck
unit tests
integration tests
build
migration verification
```

PostgreSQL and Redis service containers may be used.

Never achieve green CI by disabling important tests.

---

# 58. DOCKER / VPS

Production Compose should include:

```text
proxy
web
worker
postgres
redis
```

Requirements:

- persistent PostgreSQL volume;
- Redis as internal service;
- DB internal only;
- Redis internal only;
- healthchecks;
- restart policies;
- secure env;
- production build;
- HTTPS.

Prefer Caddy when starting fresh for automatic TLS.

Public ports normally:

80
443

---

# 59. ENVIRONMENT

Provide `.env.example`.

Include:

- database URL;
- Redis URL;
- auth/session secret;
- credential encryption key;
- app URL;
- production mode;
- reverse proxy values;
- retention configuration.

Do NOT put individual Mailgun/Resend/etc. credentials in `.env`.

The whole point is that users add providers securely from the application UI.

---

# 60. MIGRATIONS

Use real Prisma migrations.

Do not use `db push` as production migration strategy.

Verify:

- fresh DB;
- schema migration;
- application start.

---

# 61. BACKUPS

Document PostgreSQL backup and restore.

Make clear:

provider credentials are encrypted, so restoring the database ALSO requires the same credential-encryption master key.

---

# 62. DOCUMENTATION

Maintain:

```text
README.md

docs/
  ARCHITECTURE.md
  PROVIDERS.md
  SECURITY.md
  DEPLOYMENT.md
  CURRENT_WORK.md
```

`PROVIDERS.md` should document:

- official service domain;
- where API/SMTP credentials are obtained;
- supported EmailSystem transport;
- built-in endpoint behavior;
- verification strategy;
- sender/domain requirements.

Do not claim unsupported features.

---

# 63. PROVIDER ENDPOINT MAINTENANCE

Provider endpoints can change over years.

Centralize built-in definitions.

Do NOT scatter literal hosts throughout workers/routes.

For example:

```text
packages/providers/catalog
```

Every built-in host/path should have unit tests.

Before implementing each adapter, verify its current official documentation.

If official docs materially differ from this directive:

prefer the CURRENT official provider documentation and record the deviation.

Do not silently guess.

---

# 64. OPERATIONAL SAFETY

Provider switching exists for:

- workload distribution;
- quota management;
- temporary technical failure;
- maintenance;
- rate handling;
- redundancy.

If provider response indicates:

- account suspended;
- abuse enforcement;
- policy blocking;

mark that connection:

`POLICY_BLOCKED`

and require user intervention.

Do not automatically route specifically to circumvent provider enforcement.

---

# 65. IMPLEMENTATION ORDER

Recommended:

## Milestone 1
Repository truth, architecture, authentication, DB.

## Milestone 2
Provider catalog + credential encryption.

## Milestone 3
Provider adapters + Save & Verify.

## Milestone 4
Providers UI.

## Milestone 5
Imports.

## Milestone 6
Composer + HTML importer + preview.

## Milestone 7
Campaign domain and pre-flight.

## Milestone 8
Queue/workers.

## Milestone 9
Dispatcher/rate control/provider health.

## Milestone 10
Retry/idempotency/reconciliation.

## Milestone 11
Webhooks/suppressions/unsubscribe.

## Milestone 12
Activity + controls + export.

## Milestone 13
Security/concurrency/performance review.

## Milestone 14
Docker/VPS deployment.

## Milestone 15
CI/docs/final validation.

Adjust only when repository dependencies make another order clearly superior.

---

# 66. TDD

For important domain behavior:

write failing tests first.

Particularly:

- provider verification;
- dispatcher;
- retries;
- idempotency;
- suppression;
- webhook deduplication;
- campaign transitions;
- pause/resume/cancel;
- races.

---

# 67. COMMITS

Use narrow meaningful commits.

Examples:

```text
feat(auth): add secure user sessions

feat(providers): add encrypted provider catalog

feat(providers): add verified resend and mailgun adapters

feat(providers): add ses and sendgrid adapters

feat(composer): add responsive html import pipeline

feat(campaigns): add durable campaign preparation

feat(dispatch): add weighted provider selection

feat(workers): add retry-safe delivery processing

feat(activity): add live campaign operations

feat(deploy): add production docker stack
```

Before committing:

- git diff;
- git status;
- tests;
- typecheck;
- lint;
- build as appropriate.

---

# 68. DEFINITION OF DONE

Do not call this complete because three pages render.

## Providers

Complete when:

- all built-in provider cards exist;
- endpoint values are preconfigured;
- multiple instances of same provider work;
- API and SMTP transports work where specified;
- credentials encrypted;
- Save & Verify works;
- tests exist;
- provider isn't activated until usable;
- safe errors shown.

## Blast

Complete when:

- CSV/TXT/XLSX/paste works;
- validation;
- deduplication;
- suppression;
- rich editor;
- HTML import;
- preview;
- test send;
- pre-flight;
- durable campaign start.

## Engine

Complete when:

- BullMQ works;
- Redis coordination works;
- workers durable;
- weighted routing;
- rate limiting;
- health/cooldown;
- retries;
- ambiguous sends handled;
- idempotency protection.

## Activity

Complete when:

- live progress;
- real persisted counts;
- accepted != delivered;
- provider breakdown;
- filtering;
- pause;
- resume;
- cancel;
- export.

## Platform

Complete when:

- auth;
- ownership isolation;
- PostgreSQL;
- Redis;
- migrations;
- security review;
- CI;
- Docker;
- VPS documentation;
- responsive UI;
- tests;
- production build.

---

# 69. FINAL END-TO-END VERIFICATION

With MockProvider:

1. create user;
2. login;
3. add provider;
4. verify provider;
5. upload recipient file;
6. prove duplicate removal;
7. compose rich text;
8. import HTML;
9. preview mobile;
10. preview desktop;
11. pre-flight;
12. start campaign;
13. observe queue;
14. observe accepted;
15. simulate delivered webhook;
16. simulate bounce;
17. simulate temporary error;
18. prove retry;
19. simulate unknown result;
20. prove duplicate prevention;
21. pause campaign;
22. resume;
23. cancel eligible jobs;
24. export results;
25. restart worker and prove durable recovery.

Also run adapter verification tests for every built-in provider.

---

# 70. FINAL QUALITY GATES

Run:

```text
lint
typecheck
tests
integration tests
production build
fresh migration test
```

Inspect final git diff.

Verify no credentials entered test fixtures accidentally.

Verify Docker config.

Verify docs.

Verify CI on final commit where possible.

---

# 71. FINAL REPORT

At completion report:

- branch;
- final SHA;
- architecture;
- providers implemented;
- provider verification methods;
- number of tests;
- test results;
- typecheck;
- lint;
- production build;
- migration result;
- Docker readiness;
- features implemented;
- anything needing real external credentials for final live-provider proof;
- exact commands for VPS production deployment.

Do not call something verified if it was only mocked.

Distinguish:

`implemented`

from:

`verified with mock`

from:

`verified against real provider`.

---

# FINAL PRINCIPLE

The UI should remain deceptively simple:

```text
Providers
    ↓
Blast
    ↓
Activity
```

But underneath:

```text
Provider Catalog
      │
      ▼
Encrypted Connections
      │
      ▼
Provider Verification
      │
      ▼
Campaign Preparation
      │
      ▼
Durable Queue
      │
      ▼
Smart Dispatcher
      │
 ┌────┼─────┬─────┬─────┬─────┐
 SES Resend MG    SG    Brevo ...
      │
      ▼
Delivery Attempts
      │
      ▼
Provider Events/Webhooks
      │
      ▼
Normalized Delivery State
      │
 ┌────┴───────────┐
 ▼                ▼
Activity       Suppression
```

The user should only need to:

**choose a provider → paste credentials → Save & Verify → upload recipients → compose → Send → watch Activity.**

Everything else belongs to EmailSystem.

Begin with actual repository inspection now.

Continue autonomously through the defined milestones.

Do not stop after planning or scaffolding.

Build the product.