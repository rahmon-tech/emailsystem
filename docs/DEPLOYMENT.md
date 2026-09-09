# VPS deployment

## Existing multi-project VPS: `/emailblast`

The target for this installation is `https://app.promptologoy.com/emailblast`. This is a prepared deployment configuration, not a claim that the VPS is installed. The coding workspace could not reach the supplied VPS over SSH. Complete the read-only server inspection through an authorized remote connection before changing routing.

Inspect the OS, available memory/disk, Docker/Compose versions, running containers/services, listening ports, the existing HTTPS virtual host and its certificate. Preserve the current root project. Back up its proxy configuration and record the root site's status before adding the scoped route. Select the verified release commit from GitHub in an isolated directory such as `/opt/emailblast`; the private repository requires authorized access.

For a host with Docker already installed, run from the selected checkout:

```sh
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24.19.0-bookworm-slim node --experimental-strip-types scripts/setup-env.ts app.promptologoy.com /emailblast
chmod 600 .env
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml config --quiet
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml build web
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml up -d postgres redis
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml run --rm -it web node --import tsx scripts/create-user.ts
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml up -d --wait web worker
curl --fail http://127.0.0.1:3087/emailblast/health/ready
```

Enter `ray@emailblast.me` and the separately supplied password at account creation. Password input is hidden on a terminal; automated creation accepts two bounded stdin lines. Never put passwords in commands, source, CI, logs or deployment notes. Account creation refuses to overwrite an existing account.

Verify port 3087 is free before starting. If occupied, choose an unused loopback port using `EMAILBLAST_PORT` and update the proxy target together. This compose project publishes only its web process on loopback and does not start a second public proxy. Its PostgreSQL, Redis, network and persistent volumes remain isolated under the `emailblast` project name.

For an existing Nginx server, include `deploy/nginx-emailblast.conf` inside the existing `app.promptologoy.com` HTTPS server block, validate with `nginx -t`, then reload Nginx. Preserve all existing locations and certificates. For a different proxy, apply an equivalent path-scoped route only after inspecting its actual configuration. Forward `/emailblast/...` unchanged; do not strip the prefix. Overwrite the incoming client-IP headers at the trusted proxy and allow SSE responses to stream. Do not enable raw access logging for redirect paths.

Verify both the existing root project and `/emailblast/login`, authenticate with the requested account, check `/emailblast/health/ready`, provider setup, pre-flight, preview, Activity/SSE and CSV export. Sending requires a real provider connection; tracking remains off without one or more verified tracking hostnames. Do not send a live campaign as an installation health check.

`NEXT_PUBLIC_BASE_PATH` is compiled into Next.js and must equal the pathname of `APP_URL`. Rebuild when changing it. Client fetches, native links, exports and SSE include the prefix; Next navigation includes it automatically. Cookies are scoped to that path. [Next.js documents the build-time basePath behavior](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath).

For updates, use the same compose files and project name for every command. Back up the database and keys, build the selected verified commit, stop only the `emailblast` worker, apply migrations, recreate only its web/worker containers, and recheck both sites. Never run a global Docker prune or remove another project's containers/volumes. Keep the previous image and compatible backup for rollback.

## Optional tracking hostnames

Use hostnames you own. Add each in Providers → Link settings. Publish the displayed `_emailblast.<hostname>` TXT record. Configure valid TLS and route only `${NEXT_PUBLIC_BASE_PATH}/r/*` and `${NEXT_PUBLIC_BASE_PATH}/tracking/verify/*` on that hostname to the same web service, preserving the original hostname and path; return 404 for other paths on the tracking virtual host. Then choose Verify hostname. There is no on-demand TLS issuance for arbitrary Host headers.

Verification checks TXT ownership, public DNS addresses, a pinned HTTPS connection with a valid certificate and the expected challenge response. It rejects redirects and private/mixed address sets. Successful verification lasts 30 days; the worker refreshes enabled domains daily. Failed refreshes preserve the last successful validity window, and disabling a domain invalidates its links immediately. Existing links are never silently moved to a different hostname. Keep tracking-host logs disabled or aggregate/redact them with bounded retention as well.

## First installation

Use a Linux VPS with Docker Engine and the Compose plugin, a domain pointing to its public IP, and ports 80/443 open. Allow memory for both Next.js builds and PostgreSQL; 4 GB is a practical starting allocation. Verify the domain's DNS and provider sending-domain records separately.

```sh
git clone --branch main https://github.com/rahmon-tech/emailsystem.git
cd emailsystem
# Generate production .env without overwriting an existing file:
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24.19.0-bookworm-slim node --experimental-strip-types scripts/setup-env.ts mail.your-domain.com
chmod 600 .env
docker compose build
docker compose up -d postgres redis
docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose run --rm -it web node --import tsx scripts/create-user.ts
docker compose up -d
curl --fail https://mail.your-domain.com/health/live
curl --fail https://mail.your-domain.com/health/ready
```

The user creation command reads the email and password from the terminal with password echo disabled. Provider keys are subsequently entered through Providers → Save & Verify.

Caddy obtains TLS automatically and forwards the client IP. PostgreSQL and Redis are internal, backed by persistent volumes. The application requires HTTPS in production. Workers continue independently of open browsers and web restarts.

Readiness requires PostgreSQL, Redis and a recent worker heartbeat; liveness only proves the web process responds. A degraded dependency must be investigated even when Docker reports the web liveness check healthy.

## Updates

```sh
# Back up first, then inspect and select the intended release commit.
git pull --ff-only
docker compose build
docker compose stop worker
docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose up -d --force-recreate web worker proxy
curl --fail https://mail.your-domain.com/health/ready
```

Do not run `prisma db push` in production. Test upgrades against a restored backup first. Keep old image tags and a compatible database backup for rollback. SQL migrations are forward changes, not an automatic rollback mechanism.

## Backup

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres pg_dump -U emailsystem -d emailsystem -Fc > "backups/emailsystem-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Encrypt and copy backups off the VPS. Back up `.env` separately in encrypted storage: restoring encrypted provider credentials requires the same `CREDENTIAL_ENCRYPTION_KEY`; valid unsubscribe links also need the same `SESSION_SECRET`. Restrict backups because they contain recipients and message bodies.

## Restore rehearsal

On an isolated host or isolated database (never overwrite a live database as a test):

```sh
docker compose stop web worker
docker compose exec -T postgres createdb -U emailsystem emailsystem_restore
docker compose exec -T postgres pg_restore -U emailsystem -d emailsystem_restore --no-owner < backups/your-selected-backup.dump
# Point DATABASE_URL at emailsystem_restore in the isolated environment.
# Restore the encryption and session keys, then run migrations and health checks.
```

Do not run two restored installations against the same live provider accounts while recovery testing. Use mock connections in the isolated environment. Redis is reconstructible from durable database states, but keep AOF enabled and do not use an eviction policy that silently discards coordination state.

## Troubleshooting

- `docker compose logs --tail=100 web worker` shows structured, secret-free logs.
- `UNKNOWN` means acceptance could not be determined. Inspect the provider dashboard and webhook configuration. Do not duplicate the campaign as a retry.
- Campaigns waiting for providers: inspect enabled state, sender identity, cooldowns, weights and configured rate capacity for CC/BCC copies.
- SES sandbox: request production access before campaigns; verification is distinct from invalid credentials.
- Failed readiness: check database/Redis health, worker logs and available disk/memory.
- Failed webhook: verify the exact URL, raw-body signature configuration, timestamps, signing secret or public key, SNS topic ARN and provider-specific authentication notes.

The Docker image and CI configuration are provided for reproducible deployment. No unseen VPS deployment or actual TLS certificate issuance is claimed by repository tests.
