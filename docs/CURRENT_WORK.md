# Current work

## Verified baseline

The HTML fidelity and defensive tracking milestone is merged on `main`. Remote source `b5882b3c790e7ca2a1c488139469dc19a8b00d12` passed CI run 34319148808, including PostgreSQL/Redis integration, the production subpath browser workflow, migrations, upgrade rehearsal, build, and container readiness.

## Provider bootstrap, senders, and canonical tracking

The current candidate supplements that milestone without introducing a second delivery architecture:

- a server-only, idempotent bootstrap prepares exactly eight API connections: Resend, Mailgun, SendGrid, Brevo, Postmark, Mailjet, SMTP2GO, and Elastic Email;
- API credentials and optional backup SMTP credentials remain separate fields in one encrypted provider record, so backups cannot multiply routing capacity;
- `.env.providers.local` is git-ignored, must be mode `0600`, supplies the bootstrap values only on the controlled machine, and is never printed;
- dry-run/apply/verify modes expose only safe metadata, perform no automatic delivery, and leave ambiguous Postmark server-token selection unresolved until read-only probes provide evidence;
- tenant-owned domains and sender identities replace arbitrary campaign `From` text; provider authorization is explicitly domain-wide or address-specific and is rechecked when dispatch begins;
- bulk aliases do not create providers, increase limits, or change a campaign's stable sender identity;
- click tracking remains optional and defaults off. When enabled, opaque redirects use `APP_URL/r/<token>`; no hostname product flow, third-party shortener, IP history, user-agent history, cookie, fingerprint, or delivery-state inference is involved;
- preserved HTML normalization remains deterministic, safe, compatible, and faithful. It does not rewrite copy or mutate content for filter evasion.

Local Prisma validation, TypeScript, ESLint, 134 unit tests, secret scanning, diff checks, and a clean production build with `/emailblast` pass. Database-backed migration, integration, browser, and container gates are pending the candidate CI run; this file will not claim them before that evidence exists.

## Deployment target and access

Authorized target: `https://app.promptologoy.com/emailblast`, alongside existing VPS projects. The shared-host compose override binds only an isolated loopback web port; the scoped proxy configuration must be reconciled with the live VPS before installation. The requested account is `ray@emailblast.me`; its password and all provider credentials are runtime secrets and are never repository content.

Actual VPS installation, account creation, and provider authentication checks remain pending a working authorized remote connection. The workspace TCP attempt to the supplied server on SSH port 22 returned `Network is unreachable`. No server changes, certificate issuance, provider mutation, or live delivery has occurred. The provider `--verify` gate will use only provider-native reads or non-delivery sandbox validation; any real test message requires a separately approved recipient and action.
