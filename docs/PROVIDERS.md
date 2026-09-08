# Providers

All nine services support API and SMTP connections; each connection is independently named, encrypted and verified. Built-in URLs and SMTP hosts are read-only server metadata. Enter the same verified From address on connections used by one campaign. SMTP authentication verifies connectivity and credentials; sender acceptance still needs a controlled test. Save & Verify never claims inbox delivery.

| Service / credential location | API sending / authentication | SMTP preset | API verification |
| --- | --- | --- | --- |
| [Resend](https://resend.com), API Keys | `api.resend.com/emails`, Bearer | `smtp.resend.com:465`, username `resend`, API key as password | Read domains; sending-only keys use `delivered@resend.dev` with a unique idempotency key. Safe verification sends count toward quota. |
| [Amazon SES](https://aws.amazon.com/ses), IAM and regional SES console | Official SES v2 SDK, access key/secret/session token | `email-smtp.{region}.amazonaws.com:587`; separate SES SMTP credentials | GetAccount and GetEmailIdentity; sandbox shown separately, production sending enabled only when eligible. Account MaxSendRate constrains the configured rate. |
| [Mailgun](https://mailgun.com), API Security and domain SMTP credentials | `api.mailgun.net/v3/{domain}/messages` (EU: `api.eu.mailgun.net`), Basic `api:key` | US `smtp.mailgun.org:587`, EU `smtp.eu.mailgun.org:587` | Read domain, then explicit controlled test to establish send permission. Optional `o:testmode=yes` is clearly labeled as potentially billable. |
| [SendGrid](https://sendgrid.com), Settings → API Keys | `api.sendgrid.com/v3/mail/send` (EU: `api.eu.sendgrid.com`), Bearer | `smtp.sendgrid.net:587`, username `apikey` | GET `/v3/scopes`; requires `mail.send`. Verify the sending identity in SendGrid. |
| [Brevo](https://brevo.com), SMTP & API | `api.brevo.com/v3/smtp/email`, `api-key` header | `smtp-relay.brevo.com:587`, SMTP login/key | GET `/v3/account`, relay check and explicit test send. An SMTP key is different from an API key. |
| [Postmark](https://postmarkapp.com), server API token and Message Streams | `api.postmarkapp.com/email`, server token header | `smtp-broadcasts.postmarkapp.com:587`, server SMTP credentials | Real GET `/server` and Broadcast stream lookup. Does not substitute `POSTMARK_API_TEST` for the user's credential. |
| [Mailjet](https://mailjet.com), API Key Management | `api.mailjet.com/v3.1/send`, Basic public/secret key | `in-v3.mailjet.com:587`, public/secret key | Correctly structured Send API request with `SandboxMode:true`; no delivery. |
| [SMTP2GO](https://smtp2go.com), Sending → API Keys / SMTP Users | `api.smtp2go.com/v3/email/send`, `X-Smtp2go-Api-Key` | `mail.smtp2go.com:2525` | Authenticated email summary read, then explicit controlled test send if needed. Regional API hosts are `us-api`, `eu-api`, `au-api.smtp2go.com`. |
| [Elastic Email](https://elasticemail.com), Settings → API / SMTP | `api.elasticemail.com/v4/emails/transactional`, `X-ElasticEmail-ApiKey` | `smtp.elasticemail.com:587` | GET `/v4/domains` where permitted, then controlled test send. Multiple SMTP credentials can be added separately. |
| Custom SMTP | SMTP only | User-supplied public hostname; mandatory TLS/STARTTLS and certificate checks | Nodemailer `verify()`, with a separate test email for sender acceptance. |

Read-permission denial does not prove a sending-only key is invalid. Such connections show action required until an appropriate native validation or user-authorized controlled send succeeds. Tests are persisted separately as ProviderTestDelivery and do not inflate campaign statistics. Test-message sends address only the selected test recipient; campaign CC/BCC copies are omitted.

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

## Official references and deviations

The implementations were checked against current official documentation. API hosts are centralized in `packages/providers/src/catalog.ts`; payload and event contracts are covered by deterministic tests. No adapter test contacts a real recipient.

- [Resend SMTP](https://resend.com/docs/send-with-smtp), [safe test recipients](https://resend.com/docs/dashboard/emails/send-test-emails), [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).
- [SES endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html), [SNS verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
- [Mailgun SMTP and regional hosts](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp), [test-mode billing](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/test-mode). EU SMTP uses the current EU hostname rather than the directive's single global host.
- [SendGrid scopes](https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions/retrieve-a-list-of-scopes-for-which-this-user-has-access).
- [Brevo transactional send](https://developers.brevo.com/docs/send-a-transactional-email), [secured webhooks](https://developers.brevo.com/docs/secured-webhooks).
- [Postmark streams](https://postmarkapp.com/developer/api/message-streams-api), [SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp).
- [Mailjet Send API](https://dev.mailjet.com/docs/email-api/send-api-v31/send-basic-email).
- [SMTP2GO regional API/authentication](https://developers.smtp2go.com/reference/general-api-resources), [native webhook events](https://developers.smtp2go.com/docs/webhooks-overview).
- [Elastic Email v4 REST specification](https://elasticemail.com/developers/api-documentation/rest-api), [native notification format](https://help.elasticemail.com/en/articles/4804685-notification-settings). Native GET callbacks use shared-secret authentication rather than a fictitious signature scheme.

Live acceptance and confirmed delivery still need each account's credentials, verified sender, quota, webhook setup and provider-specific permission configuration. API/SDK/SMTP mocks verify contracts and safety boundaries; they do not prove the state of an external account.
