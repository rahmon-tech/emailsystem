# Implementation and verification report

This report separates implemented behavior from evidence actually collected. It does not treat configured credentials, provider authentication, sender authorization, inbox delivery, or VPS installation as interchangeable facts.

## Current candidate

The candidate adds the production provider bootstrap and sender-identity model to the existing TypeScript/PostgreSQL/Redis architecture. The exact commit and CI URL will be recorded after a secret-free branch is pushed and all remote gates finish.

### Local evidence

| Gate                   | Result                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Prisma schema          | Valid; client generation succeeds.                                                               |
| TypeScript             | Passes with no emitted output.                                                                   |
| ESLint                 | Passes across apps, packages, tests, and scripts.                                                |
| Unit tests             | **134 passed.**                                                                                  |
| Production build       | Passes with `APP_URL=https://localhost:3443/emailblast` and `NEXT_PUBLIC_BASE_PATH=/emailblast`. |
| Repository secret scan | Passes without printing matching content.                                                        |
| Patch hygiene          | `git diff --check` passes.                                                                       |

PostgreSQL migrations, Redis integration, production HTTPS browser workflows, and container readiness require the CI services and are not marked passed until the candidate CI run completes.

## Implemented acceptance boundaries

### Providers and runtime secrets

- The bootstrap catalog contains exactly eight primary API connections: Resend, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO, and Elastic Email. Amazon SES remains available in the ordinary catalog but is not part of this bootstrap.
- `.env.providers.example` contains variable names only. `.env.providers.local` is ignored, permission-checked, loaded only by the server-side CLI, and never copied into a container image.
- Apply is idempotent by tenant and bootstrap key. Credentials are encrypted with the existing authenticated credential-storage layer before database persistence.
- Mailgun management and sending keys are distinct. Optional SMTP credentials remain separate encrypted fields and do not create another routable connection.
- Verification uses documented read operations or provider-native non-delivery validation. It does not send unsolicited email. A Postmark token is not selected when safe probes leave more than one valid candidate.
- Connection health and sender/domain authorization are displayed separately. No domain or sender becomes `VERIFIED` merely because a key was saved.

### Sender identity and dispatch

- Domains, aliases, and provider authorization records are tenant-scoped by composite database relations.
- Campaigns select an enabled stored identity; arbitrary `From` addresses and foreign sender IDs are rejected.
- Authorization scope is either `DOMAIN_WIDE` or `ADDRESS_SPECIFIC`. Address-specific evidence does not silently authorize sibling aliases.
- Provider eligibility is checked during pre-flight, when a delivery is claimed, and immediately before transport. Changing a provider's configured domain retires its old authorization.
- A campaign snapshot keeps one sender for all recipients. Aliases do not multiply provider quotas, rates, concurrency, or safety budgets.

### Tracking, privacy, and reputation

- Tracking defaults off and sending does not depend on it. With tracking off, safe HTTP/HTTPS destinations remain direct.
- When explicitly enabled, links use the canonical `APP_URL/r/<opaque-token>` route. No separate hostname workflow or third-party shortening service exists.
- Redirect destinations come only from tenant-scoped database records. Request parameters, headers, and referrers cannot replace them.
- Analytics persist daily raw and likely-automated aggregates only. Full IPs, user-agent history, fingerprints, cookies, and unrelated headers are not stored.
- Scanner classification is heuristic. Redirect visits never modify delivery state or trigger security-sensitive business actions.
- Reputation sources normalize to `REPUTATION_CLEAN`, `REPUTATION_BLOCKED`, or `REPUTATION_UNKNOWN`. Absence from a deny list and provider outages remain unknown. Unknown results block only under explicit policy.
- Existing opaque links and aggregate history survive the schema transition; tracking is forced off during upgrade until the canonical route is operational.

### HTML fidelity

Representative newsletter and announcement fixtures assert table hierarchy, CTA placement, text, images, widths, spacing, responsive CSS, buttons, and supported Outlook fallbacks. Safety normalization removes active content and reports visible structural changes without rewriting marketing copy, randomizing recipients, concealing URLs, or attempting filter evasion.

## Verification boundaries

- Provider request contracts and responses are tested with synthetic credentials and injected transports. These tests do not prove any live account's permissions.
- Live credential checks and sender/domain status will be recorded only from the controlled deployment machine. The safe bootstrap verify command performs no delivery.
- Provider acceptance from a later explicitly requested test message would prove only provider acceptance for that sender—not inbox placement or human receipt.
- VPS deployment, HTTPS, coexistence with existing projects, account creation, backups, and live readiness remain unverified until a working remote connection is available and the running host is inspected.

See [provider setup](PROVIDERS.md), [deployment](DEPLOYMENT.md), [architecture](ARCHITECTURE.md), and [security](SECURITY.md) for operating details.
