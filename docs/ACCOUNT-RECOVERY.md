# EmailBlast administrator account recovery (no SMTP required)

This flow is for an administrator who has lost access while the sending
provider is not configured. It **does not send an email or OTP**. A Railway
workspace administrator must issue a one-time recovery code out of band.

The publicly reachable recovery form is at `/recover`. Unless all three
variables below are configured and unexpired, the form is disabled. There
is no recovery code stored in GitHub or default password.

## Issue one recovery code

Use a secure terminal on a trusted computer and generate a random
32-byte base64url code and SHA-256 digest. For example:

```bash
node -e 'const c=require("node:crypto"); const code=c.randomBytes(32).toString("base64url"); console.log("ONE_TIME_CODE="+code); console.log("SHA256="+c.createHash("sha256").update(code).digest("hex"));'
```

In Railway, open the **production @emailsystem/web** service and set:

- `ACCOUNT_RECOVERY_EMAIL`: the *existing* user's exact sign-in email.
- `ACCOUNT_RECOVERY_CODE_SHA256`: the SHA256 hex digest (never the code).
- `ACCOUNT_RECOVERY_EXPIRES_AT`: current UTC epoch **milliseconds** plus
  15–30 minutes; never more than 60 minutes from current time.

For example, calculate the timestamp with:

```bash
node -p 'Date.now() + 20 * 60 * 1000'
```

Redeploy the web service if Railway doesn't deploy automatically, and
verify `/recover` is enabled. Send the original `ONE_TIME_CODE` to
the authorized account owner over a trusted private channel.
**Never put the code in the URL**, email campaign, repository, build
arguments, request logs, or shared documents.

The account owner visits `/recover`, enters the account email,
the one-time code, and a new 12+ character password. The route checks
the configured email, SHA-256 digest and expiry, rate-limits requests,
atomically claims the code in Redis (SET NX), updates the password with
the usual salted scrypt hash, and deletes existing sessions.

## Immediately after use

1. Delete all three `ACCOUNT_RECOVERY_*` variables from the Railway
   web service and allow it to redeploy.
2. Confirm the new password works at `/login`.
3. Check Railway runtime logs for `auth.account_recovered`. Logs never
   contain the code or account email.
4. For a failed attempt or an expired code, rotate the digest/code
   and deadline; do not reactivate the same code.

## Security limits

- No email provider is needed; this is **not** a self-service email
  verification system. Only the Railway administrator can authorize a
  code, so never offer code issuance to an unauthenticated web user.
- Recovery depends on Redis for single-use enforcement. A Redis outage
  blocks redemption rather than bypassing checks.
- Do not use recovery variables as permanent application credentials.
  With no active recovery grant the endpoint rejects every attempt.
- Add a verified transactional sender and email reset-token workflow
  separately before enabling ordinary self-service recovery.
