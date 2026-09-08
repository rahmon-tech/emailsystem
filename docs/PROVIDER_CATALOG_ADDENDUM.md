Continue from the repository state you have already created.

Do NOT restart or re-scaffold the project.

The following requirement is now mandatory and should be incorporated into the existing provider architecture before the Providers milestone is considered complete.

# BUILT-IN PROVIDER CATALOG — REQUIRED

EmailSystem must contain a typed, centralized catalog of known sending providers.

For built-in providers, the user MUST NOT manually enter API base URLs or SMTP hostnames.

The application should already know:

- official provider website;
- API base URL;
- send endpoint/path;
- authentication method;
- SMTP hostname;
- supported SMTP ports;
- TLS mode;
- required credential fields;
- verification strategy;
- provider capabilities.

The normal UI should only ask the user for the credentials/settings that vary per account.

Example:

```ts
export interface ProviderCatalogEntry {
  id: ProviderType;
  name: string;
  website: string;

  api?: {
    baseUrl: string;
    sendPath: string;
    authType: string;
  };

  smtp?: {
    host: string | ((config: unknown) => string);
    ports: {
      port: number;
      security: "starttls" | "tls";
      recommended?: boolean;
    }[];
  };
}

```

Do not scatter these constants across route handlers/workers.

Create one canonical provider catalog module, for example:

```text
src/providers/catalog/

```

or an equivalent location fitting the architecture already established.

Every built-in provider adapter must consume this catalog.

Add tests proving the correct endpoint is selected.

---

# 1. RESEND

Website:

`https://resend.com`

## API

Base URL:

`https://api.resend.com`

Send endpoint:

`POST /emails`

Full endpoint:

`https://api.resend.com/emails`

Authentication:

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json

```

User fields:

- connection name;
- API key;
- From email;
- From name;
- Reply-To;
- optional sending domain;
- weight;
- configured rate.

Do NOT ask for the API endpoint.

## SMTP

Host:

`smtp.resend.com`

Username:

`resend`

Password:

the user's Resend API key.

Ports:

```text
465   implicit TLS
2465  implicit TLS

25    STARTTLS
587   STARTTLS — recommended
2587  STARTTLS

```

Prefer:

`587 STARTTLS`

or:

`465 TLS`.

## Testing

Support Resend's safe test address:

`delivered@resend.dev`

Use it only for explicit controlled provider testing.

Where supported, use a unique idempotency key.

---

# 2. MAILGUN

Website:

`https://www.mailgun.com`

Mailgun is regional.

The user selects:

- US
- EU

## API — US

Base URL:

`https://api.mailgun.net`

Send path:

`/v3/{domain}/messages`

Full pattern:

`https://api.mailgun.net/v3/{domain}/messages`

## API — EU

Base URL:

`https://api.eu.mailgun.net`

Full pattern:

`https://api.eu.mailgun.net/v3/{domain}/messages`

Authentication:

HTTP Basic.

Username:

`api`

Password:

Mailgun API key.

Required account-specific fields:

- API key;
- Mailgun sending domain;
- region;
- From address;
- From name;
- Reply-To;
- connection name.

Do not ask user to type the API host.

## SMTP — US

Host:

`smtp.mailgun.org`

## SMTP — EU

Host:

`smtp.eu.mailgun.org`

Ports:

```text
25    STARTTLS capable
587   STARTTLS — recommended
2525  STARTTLS
465   implicit TLS

```

Default to:

`587 STARTTLS`.

SMTP credentials are the Mailgun SMTP credentials for the configured domain, not necessarily the account API key.

Make this distinction explicit in the UI.

---

# 3. AMAZON SES

Website:

`https://aws.amazon.com/ses/`

Use AWS SDK for JavaScript v3 for API mode.

Do NOT make users enter an SES API endpoint manually.

The user chooses an AWS region.

Example regions:

```text
us-east-1
us-east-2
us-west-2
eu-west-1
eu-west-2
eu-central-1
ap-south-1
ap-southeast-1
ap-southeast-2
ap-northeast-1

```

Use the current AWS SDK regional endpoint resolution rather than hardcoding API hosts manually.

## API credentials

Fields:

- region;
- Access Key ID;
- Secret Access Key;
- optional Session Token;
- From address;
- From name;
- Reply-To;
- connection name.

## API verification

Use SES v2:

`GetAccount`

HTTP operation:

`GET /v2/email/account`

Use the official SDK instead of manually signing this request.

Verification should retrieve useful values including where available:

- SendingEnabled;
- ProductionAccessEnabled;
- EnforcementStatus;
- send quota;
- maximum send rate.

Distinguish:

`SES SANDBOX`

from:

`INVALID CREDENTIALS`.

## SMTP

Hostname pattern:

`email-smtp.{region}.amazonaws.com`

Example:

`email-smtp.us-west-2.amazonaws.com`

The app generates this hostname automatically from region.

Supported ports:

```text
25    STARTTLS
587   STARTTLS — recommended
2587  STARTTLS

465   TLS wrapper
2465  TLS wrapper

```

TLS is mandatory.

Important:

AWS SES SMTP credentials are separate from normal AWS access-key credentials.

The UI must explain this clearly.

---

# 4. TWILIO SENDGRID

Website:

`https://sendgrid.com`

## API — Global

Base URL:

`https://api.sendgrid.com`

Mail send endpoint:

`POST /v3/mail/send`

Full endpoint:

`https://api.sendgrid.com/v3/mail/send`

## API — EU regional subusers

Base URL:

`https://api.eu.sendgrid.com`

Endpoint:

`POST /v3/mail/send`

Do not expose endpoint entry to the normal user.

Authentication:

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json

```

## Verification

Use an authenticated capability/scope check where supported.

The provider configuration should determine whether the API key has mail-send permission.

If authentication succeeds but sending permission is missing:

do NOT report `INVALID API KEY`.

Report:

`MISSING SEND PERMISSION`.

## SMTP

Host:

`smtp.sendgrid.net`

Username:

literal string:

`apikey`

Password:

the actual SendGrid API key.

Ports:

```text
25
2525
587   STARTTLS — recommended
465   implicit TLS

```

Default:

`587 STARTTLS`.

---

# 5. BREVO

Website:

`https://www.brevo.com`

## API

Base URL:

`https://api.brevo.com/v3`

Send endpoint:

`POST /smtp/email`

Full endpoint:

`https://api.brevo.com/v3/smtp/email`

Authentication:

```http
api-key: <BREVO_API_KEY>
Content-Type: application/json

```

Do not ask user for endpoint.

## Verification

Use a harmless account/capability operation where appropriate.

Brevo also supports sandbox-style validation.

For safe payload verification, Brevo supports:

```http
X-Sib-Sandbox: drop

```

on transactional email requests.

This should validate a request without actual delivery.

Do not count sandbox verification as a real delivered email.

## SMTP

Host:

`smtp-relay.brevo.com`

Recommended port:

`587 STARTTLS`

Also support:

```text
2525 STARTTLS
465  TLS

```

Important:

Brevo SMTP authentication uses an SMTP key.

Do not assume the API key is the SMTP password.

The form must label these correctly.

---

# 6. POSTMARK

Website:

`https://postmarkapp.com`

## API

Base URL:

`https://api.postmarkapp.com`

Send endpoint:

`POST /email`

Full endpoint:

`https://api.postmarkapp.com/email`

Authentication:

```http
X-Postmark-Server-Token: <SERVER_TOKEN>
Accept: application/json
Content-Type: application/json

```

## Message streams

Postmark distinguishes:

- Transactional
- Broadcast

Bulk campaign-style email must support/select an appropriate Broadcast Message Stream.

Do not silently route a bulk campaign to Postmark's default transactional stream.

## SMTP — Transactional

Host:

`smtp.postmarkapp.com`

## SMTP — Broadcast

Host:

`smtp-broadcasts.postmarkapp.com`

Ports:

```text
25
2525
587

```

Use STARTTLS.

Prefer:

`587`.

Credentials may use Postmark server/API token or stream-specific SMTP credentials depending on configuration.

Model this explicitly.

---

# 7. MAILJET

Website:

`https://www.mailjet.com`

## API

Base URL:

`https://api.mailjet.com`

Recommended send API:

`POST /v3.1/send`

Full endpoint:

`https://api.mailjet.com/v3.1/send`

Authentication:

HTTP Basic.

Username:

Mailjet public API key.

Password:

Mailjet secret API key.

Do not ask for endpoint.

## Sandbox validation

Mailjet supports:

```json
{
  "SandboxMode": true
}

```

for Send API validation.

Use this where appropriate during `Save & Verify`.

Sandbox validation must NOT be counted as an actual delivery.

## SMTP

Host:

`in-v3.mailjet.com`

Credentials:

- username = Mailjet API key;
- password = Mailjet secret key.

Ports include:

```text
25
80
2525
587
588
465

```

Prefer:

`587 STARTTLS`

or:

`465 TLS`.

---

# 8. SMTP2GO

Website:

`https://www.smtp2go.com`

Implement this provider in addition to the original provider list.

## API — Global

Base URL:

`https://api.smtp2go.com/v3`

Send endpoint:

`POST /email/send`

Full endpoint:

`https://api.smtp2go.com/v3/email/send`

## API — Regional

US:

`https://us-api.smtp2go.com/v3`

EU:

`https://eu-api.smtp2go.com/v3`

Australia:

`https://au-api.smtp2go.com/v3`

Allow region selection.

Global may remain the default.

Authentication should support the documented API-key mechanism, preferably:

```http
X-Smtp2go-Api-Key: <API_KEY>

```

## SMTP

Default host:

`mail.smtp2go.com`

Optional regional hosts may include:

```text
mail-us.smtp2go.com
mail-eu.smtp2go.com
mail-eu2.smtp2go.com
mail-au.smtp2go.com

```

Standard STARTTLS/no-encryption capable ports:

```text
25
2525  — recommended by SMTP2GO
8025
587
80

```

SSL ports:

```text
465
8465
443

```

Prefer:

`2525 STARTTLS`

or:

`587 STARTTLS`.

Use the SMTP username/password created in SMTP2GO's Sending → SMTP Users section.

---

# 9. ELASTIC EMAIL

Website:

`https://elasticemail.com`

Implement this provider in addition to the original provider list.

## API

Base URL:

`https://api.elasticemail.com/v4`

Email endpoint:

`POST /emails`

Full endpoint:

`https://api.elasticemail.com/v4/emails`

Transactional endpoint where appropriate:

`POST /emails/transactional`

Full:

`https://api.elasticemail.com/v4/emails/transactional`

Authentication:

Elastic Email API key according to its v4 API requirements.

Model required API access level/permission errors correctly.

Do not call a key invalid solely because it lacks an optional read permission.

## SMTP

Host:

`smtp.elasticemail.com`

Ports:

```text
25
2525
587
465

```

TLS 1.2/SSL supported.

Prefer:

`587 STARTTLS`

or:

`465 TLS`.

The user enters their Elastic Email SMTP username and generated SMTP password.

---

# 10. CUSTOM SMTP

Also implement:

`Custom SMTP`

Unlike built-in presets, this one allows manual configuration.

Fields:

- connection name;
- hostname;
- port;
- username;
- password;
- security;
- From email;
- From name;
- Reply-To;
- connection timeout;
- configured concurrency;
- configured rate;
- weight.

Security values:

```text
STARTTLS
Implicit TLS

```

Never disable certificate validation by default.

---

# 11. PROVIDER UI REQUIREMENT

The Providers page should visually offer:

```text
Resend
Mailgun
Amazon SES
SendGrid
Brevo
Postmark
Mailjet
SMTP2GO
Elastic Email
Custom SMTP

```

Selecting a provider loads the relevant form.

For example, selecting Resend API should NOT show:

```text
API endpoint: [                 ]

```

Instead EmailSystem already knows:

`https://api.resend.com`

The UI should only request:

```text
Connection name
API key
From email
From name
Reply-To
Weight
Rate settings

```

Likewise Mailgun asks for region and domain, and EmailSystem resolves the correct endpoint automatically.

---

# 12. SAVE & VERIFY — MANDATORY

Provider onboarding is not complete when credentials are merely persisted.

Default action:

`Save & Verify`

Pipeline:

```text
Validate input
      ↓
Normalize provider configuration
      ↓
Encrypt credential
      ↓
Persist connection
      ↓
Run provider-specific verification
      ↓
Normalize result
      ↓
Set provider status

```

Statuses should support at least:

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
CONFIG_ERROR
DISABLED

```

An unverified or unusable provider must not enter the dispatcher pool.

---

# 13. API VERIFICATION IS DIFFERENT FROM SMTP VERIFICATION

For SMTP providers:

Use Nodemailer `verify()` or an equivalent real SMTP authentication/connection verification.

This should prove:

- DNS/host reachable;
- TLS negotiation;
- authentication accepted.

It should NOT send a real email unless the user explicitly runs:

`Send Test Email`.

For APIs:

Prefer non-delivery verification methods.

Examples:

```text
SES:
GetAccount

Brevo:
authenticated account request and/or sandbox request

Mailjet:
SandboxMode validation

SendGrid:
authenticated permission/scope validation

Postmark:
authenticated server endpoint

Resend:
credential/capability verification; explicit safe test delivery where required

```

Where a provider cannot safely prove send permission without sending:

report that distinction.

Example:

```text
Authentication: verified
Send permission: requires test delivery

```

Do not lie by marking it fully verified when only a read-only API call worked.

---

# 14. SEND TEST EMAIL

Every provider connection should expose:

`Send Test Email`

This is separate from normal Save & Verify.

Test delivery must:

- use the exact stored provider connection;
- allow a test recipient;
- record provider message ID;
- display accepted/rejected;
- display safe normalized error;
- never alter campaign statistics.

Persist separately as something equivalent to:

`ProviderTestDelivery`.

---

# 15. PROVIDER CATALOG TESTS — REQUIRED

For every built-in provider add deterministic tests proving:

- expected API base URL;
- expected send path;
- expected SMTP hostname;
- expected port/security defaults;
- expected authentication format;
- correct regional selection;
- user cannot override built-in endpoint through ordinary API input;
- credentials are redacted;
- malformed credentials fail safely;
- connection verification updates state correctly.

Especially test:

```text
Mailgun US vs EU
SendGrid Global vs EU
SES region → generated SMTP hostname
Postmark Broadcast vs Transactional SMTP host
SMTP2GO Global vs regional endpoint

```

---

# 16. IMPORTANT IMPLEMENTATION RULE

Before finalizing each provider adapter, re-check that provider's CURRENT official documentation.

Endpoint information can change.

If current official documentation differs from this addendum:

1. use the official current value;
2. add/update the provider-catalog test;
3. document the difference in `docs/PROVIDERS.md`.

Do not silently guess.

---

# 17. DOCUMENTATION

Create:

`docs/PROVIDERS.md`

Include a table containing for every provider:

- service;
- website;
- API/SMTP support;
- built-in API host;
- built-in SMTP host;
- recommended port;
- credential type;
- verification approach;
- important setup notes.

The product UI should also contain a small:

`Where do I get this?`

link beside credential fields.

That link should point to official provider documentation/account setup, not random blogs.

---

# 18. CONTINUE CURRENT BUILD

You already established that the repository was empty and started the TypeScript/Next.js/MUI/PostgreSQL/Redis/BullMQ foundation.

Preserve that work.

Do not restart the project.

Integrate this catalog requirement into the provider/domain architecture you are currently building.

Complete provider catalog + endpoint tests before considering provider onboarding finished.

Then continue the existing master directive autonomously.