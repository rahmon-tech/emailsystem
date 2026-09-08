# Providers

The built-in catalog covers Resend, Amazon SES, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO, Elastic Email, and Custom SMTP. Each saved connection has its own name, encrypted credentials, verification state and limits. The development Mock provider is separately gated.

`packages/providers/src/catalog.ts` is the canonical source for websites, regional hosts, send/verification paths, typed authentication, credential fields and help links, SMTP port/TLS pairs, verification strategies and native test capabilities. API adapters, SMTP transport construction, server validation and the provider form consume it. Built-in host/path overrides and incompatible port/TLS settings are rejected. Custom SMTP accepts a public hostname, port, TLS mode, credentials and a 5–60 second connection timeout. Certificate verification is always enabled.

## API and credential setup

| Service | API sending / authentication | Required credentials and setup | Save & Verify |
| --- | --- | --- | --- |
| [Resend](https://resend.com) | `https://api.resend.com/emails`; Bearer | [API key](https://resend.com/docs/dashboard/api-keys/introduction); verified sending domain | Read domains. A named restricted-key response or unavailable domain permission stays UNVERIFIED. Never automatically sends. Explicit Send Test Email defaults to `delivered@resend.dev` and uses a unique idempotency key. |
| [Amazon SES](https://aws.amazon.com/ses) | Official SES v2 SDK v3; regional AWS SigV4 | [Access Key ID, Secret Access Key](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html), optional session token, region; SES send/GetAccount/GetEmailIdentity permissions | GetAccount/GetEmailIdentity establish account, identity, sandbox, quota and enforcement state. SHUTDOWN blocks sending; sandbox and exhausted quota stay outside campaigns. The SDK resolves the API endpoint. |
| [Mailgun](https://mailgun.com) | US `https://api.mailgun.net`, EU `https://api.eu.mailgun.net`; `/v3/{domain}/messages`; Basic `api:key` | [API key](https://documentation.mailgun.com/docs/mailgun/quickstart), sending domain, US/EU region | Domain read where permitted; controlled test establishes sending permission. Optional native test mode prevents delivery and may be billed. |
| [SendGrid](https://sendgrid.com) | Global `https://api.sendgrid.com`, EU `https://api.eu.sendgrid.com`; `/v3/mail/send`; Bearer | [API key](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys) with `mail.send`, authenticated sending identity, region | GET `/v3/scopes`; inspect `mail.send`. Read permission denial is distinguished from invalid authentication. Sender acceptance remains explicitly unproven until tested. |
| [Brevo](https://brevo.com) | `https://api.brevo.com/v3/smtp/email`; `api-key` header | [API key](https://developers.brevo.com/docs/send-a-transactional-email), configured sender | GET `/v3/account`, relay check and native sandbox format validation. Format success remains UNVERIFIED until a delivery-capable controlled test succeeds. |
| [Postmark](https://postmarkapp.com) | `https://api.postmarkapp.com/email`; `X-Postmark-Server-Token`, `Accept: application/json` | [Server token](https://postmarkapp.com/developer/user-guide/send-email-with-api), explicit Message Stream ID/type | GET `/server` and `/message-streams/{id}` with the supplied token. Campaigns require Broadcast; Sandbox servers are ineligible. Never substitutes `POSTMARK_API_TEST`. |
| [Mailjet](https://mailjet.com) | `https://api.mailjet.com/v3.1/send`; Basic public/secret | [Public API key and secret key](https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-can-I-configure-my-SMTP-parameters), verified sender/domain | Send API with root `SandboxMode: true` validates message processing without delivery. Empty sandbox message IDs are not invented. |
| [SMTP2GO](https://smtp2go.com) | `https://api.smtp2go.com/v3/email/send`; regional `us-api`, `eu-api`, `au-api.smtp2go.com`; `X-Smtp2go-Api-Key` | [API key](https://developers.smtp2go.com/reference/general-api-resources), Verified Sender, region | Authenticated POST `/v3/stats/email_summary`, followed by a controlled test for sending permission. |
| [Elastic Email](https://elasticemail.com) | `https://api.elasticemail.com/v4/emails/transactional`; `X-ElasticEmail-ApiKey` | [API key](https://help.elasticemail.com/en/articles/4799160-api-settings) with `SendHttp`, verified identity | GET `/v4/domains` where allowed, then controlled sending test. Domain read and sending permissions are distinct. |

## SMTP presets

All STARTTLS ports require a successful TLS upgrade before authentication. Implicit TLS ports begin with TLS. API keys and SMTP passwords are separate whenever the provider defines them separately.

| Service | Host | Recommended | STARTTLS ports | Implicit TLS ports | SMTP credentials |
| --- | --- | --- | --- | --- | --- |
| Resend | `smtp.resend.com` | 465 / TLS | 25, 587, 2587 | 465, 2465 | Username `resend`; API key as password |
| SES | `email-smtp.{region}.amazonaws.com` | 587 / STARTTLS | 25, 587, 2587 | 465, 2465 | [Separate regional SES SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html) |
| Mailgun | US `smtp.mailgun.org`; EU `smtp.eu.mailgun.org` | 587 / STARTTLS | 25, 2525, 587 | 465 | [Domain SMTP username/password](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp) |
| SendGrid | `smtp.sendgrid.net` | 587 / STARTTLS | 25, 2525, 587 | 465 | Username `apikey`; API key as password |
| Brevo | `smtp-relay.brevo.com` | 587 / STARTTLS | 587, 2525 | 465 | [SMTP login and SMTP key](https://developers.brevo.com/docs/smtp-integration), distinct from API key |
| Postmark | Broadcast `smtp-broadcasts.postmarkapp.com`; Transactional `smtp.postmarkapp.com` | 587 / STARTTLS | 25, 2525, 587 | — | Explicit mode: server token as both username/password, or stream SMTP access key/secret key. See [SMTP credentials](https://postmarkapp.com/developer/user-guide/send-email-with-smtp). |
| Mailjet | `in-v3.mailjet.com` | 587 / STARTTLS | 25, 80, 2525, 587, 588 | 465 | Public API key as username; secret key as password |
| SMTP2GO | `mail.smtp2go.com` | 2525 / STARTTLS | 25, 2525, 8025, 587, 80 | 465, 8465, 443 | SMTP Users username/password; [setup](https://www.smtp2go.com/setupguide/php_mailer/) |
| Elastic Email | `smtp.elasticemail.com` | 587 / STARTTLS | 25, 2525, 587 | 465 | [SMTP username/password](https://help.elasticemail.com/en/articles/4803409-smtp-settings) |
| Custom SMTP | User-supplied public host | 587 / STARTTLS | User-selected | User-selected | Mail-service username/password |

Postmark defaults to Broadcast. The form exposes both SMTP credential modes and stream types; `X-PM-Message-Stream` is always explicit. Transactional connections are available for controlled tests and cannot join the campaign dispatcher pool, even after a successful test. Existing Postmark SMTP connections retain the legacy username/password credential mode unless explicitly changed.

## Verification and controlled tests

Save & Verify validates and normalizes input, encrypts credentials using ownership-bound authenticated encryption, persists TESTING with sending disabled, runs provider verification and persists checks plus status. The active pool requires enabled/HEALTHY state, a compatible From identity and no active cooldown. Verification checks distinguish authentication, sender/permission uncertainty, quota and enforcement. Read-only access alone is not represented as proven send permission.

SMTP verification calls Nodemailer `verify()` only. It confirms DNS/TLS/authentication and explicitly reports sender acceptance as unknown. No SMTP email is sent during Save & Verify. API verification uses read-only or provider-native non-delivery operations. Resend's safe address is used only after the user clicks Send Test Email; it is never a fallback from a failed read request.

Controlled tests always use the selected stored connection and recipient, omit campaign CC/BCC, preserve the provider message ID and safe result, and write a separate ProviderTestDelivery. They never create campaign attempts or change campaign statistics. The nullable `testMode` field records whether a new test requested native non-delivery mode or a normal send; historical rows retain unknown mode. Brevo format-only tests cannot promote a connection to HEALTHY. Native test modes are unavailable for SMTP and are rejected before any network action when unsupported. Acceptance does not establish inbox delivery.

## Webhooks

The connection's advanced section shows `/api/webhooks/{connectionId}`. Enter signing configuration in that same section and configure the provider dashboard. Credentials are never revealed afterward. When editing a connection, replace its sending credential and preserve unchanged webhook secrets by leaving those advanced fields blank.

| Provider | Authentication | Setup |
| --- | --- | --- |
| Resend | Svix SHA-256 signature over raw body, ID and timestamp | Copy the endpoint signing secret (`whsec_…`); enable sent/delivered/bounced/complained/opened/clicked events. |
| SES | Verified AWS SNS RSA signature, approved SNS certificate host, exact configured topic ARN | Enter the SNS Topic ARN. Attach delivery/bounce/complaint notifications to the identity; subscribe the URL. Only authenticated SNS confirmations to the AWS topic are followed. |
| Mailgun | HMAC timestamp + token | Enter the Mailgun webhook signing key. Configure domain event webhooks. |
| SendGrid | ECDSA signed Event Webhook | Enable signed events and enter its base64 public verification key. |
| Brevo, Postmark, Mailjet, SMTP2GO | HTTPS Basic authentication | Set a strong random webhook password and username `emailsystem` in the provider webhook authentication settings or URL userinfo where required. |
| Elastic Email | Secret `key` query parameter on native GET callbacks | Configure the displayed URL plus `?key=YOUR_RANDOM_SECRET`. Treat that full URL as a credential. Native event notifications may require a paid provider plan. |
| Custom SMTP | None | Acceptance is tracked; delivery confirmation has no portable SMTP notification standard. |

Event matching uses the returned provider message ID and provider-supported attempt metadata. SMTP servers can rewrite message IDs; establish correlation with your provider's actual notification format during live onboarding. Unknown results remain held safely if no matching event arrives.

## Official references and checked deviations

Provider documentation was rechecked on 2026-09-08. Deterministic tests assert literal hosts/paths, authentication, regional routing, all supported port/TLS pairs, Postmark modes, no-send verification, malformed inputs, safe errors and persisted verification states. Provider transports in these tests are mocked; no real provider account or recipient is claimed verified.

- Resend: [SMTP](https://resend.com/docs/send-with-smtp), [key permissions](https://resend.com/docs/dashboard/api-keys/introduction), [errors](https://resend.com/docs/api-reference/errors). Current named errors distinguish a restricted sending-only key (`restricted_api_key`, documented 401) from an invalid key (`invalid_api_key`, documented 403); HTTP status alone is insufficient. A successful domain read uses a full-access key, whose documented capabilities include sending. [Controlled test addresses](https://resend.com/docs/dashboard/emails/send-test-emails) remain explicit actions.
- SES: [SMTP TLS/ports](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html), [regional endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html), [GetAccount fields](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html). SDK endpoint resolution is retained; no arbitrary regional API URL is accepted.
- Mailgun: [SMTP](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp), [quickstart/authentication](https://documentation.mailgun.com/docs/mailgun/quickstart), [test-mode billing](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/test-mode). US/EU API and SMTP mapping is explicit.
- SendGrid: [scopes and regional API bases](https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions/retrieve-a-list-of-scopes-for-which-this-user-has-access), [SMTP](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api). The EU API is for EU regional subusers; SMTP uses the documented global SMTP host.
- Brevo: [transactional API](https://developers.brevo.com/docs/send-a-transactional-email), [sandbox](https://developers.brevo.com/docs/using-sandbox-mode), [SMTP](https://developers.brevo.com/docs/smtp-integration). `X-Sib-Sandbox: drop` belongs inside the JSON payload's `headers` object, not the HTTP request headers. Brevo documents this as format validation only. The application requires STARTTLS on 587/2525 even where provider prose describes the initial connection as unencrypted.
- Postmark: [SMTP host/auth modes](https://postmarkapp.com/developer/user-guide/send-email-with-smtp), [server API and DeliveryType](https://postmarkapp.com/developer/api/server-api), [message streams](https://postmarkapp.com/developer/api/message-streams-api). Transactional presets are supported for explicit tests; bulk campaigns remain Broadcast-only. Sandbox servers stay SANDBOX.
- Mailjet: [SMTP port table](https://dev.mailjet.com/docs/smtp-relay/configuration), [Send API](https://dev.mailjet.com/docs/email-api/send-api-v31/send-basic-email), [sandbox](https://dev.mailjet.com/docs/email-api/send-api-v31/sandbox-mode). Ports 80, 588, 25 and 2525 are now included alongside 587/465. SandboxMode is at the request root; successful sandbox responses need not contain usable message IDs.
- SMTP2GO: [regional API and authentication](https://developers.smtp2go.com/reference/general-api-resources), [SMTP setup](https://www.smtp2go.com/setupguide/php_mailer/), [port FAQ](https://www.smtp2go.com/faq/). Global SMTP is retained; regional API hosts are explicit. The FAQ confirms the listed STARTTLS ports and TLS ports 465/8465. Port 443 is retained from the supplied addendum as an advanced TLS alternative; it is not listed in the current FAQ and has not been live-tested. Default 2525 is unchanged.
- Elastic Email: [v4 specification](https://elasticemail.com/developers/api-documentation/rest-api), [API settings](https://help.elasticemail.com/en/articles/4799160-api-settings), [SMTP settings](https://help.elasticemail.com/en/articles/4803409-smtp-settings). The existing transactional endpoint is appropriate for the app's per-recipient message with explicit copies. It requires SendHttp; domain lookup requires separate permission. API and SMTP credentials are distinct.

Live acceptance and confirmed delivery require account credentials, a verified sender, available quota, notification configuration and an explicitly selected test recipient. The original master directive and the provider catalog addendum are preserved in this repository.
