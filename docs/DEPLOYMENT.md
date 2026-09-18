# VPS deployment

## Existing multi-project VPS: `/emailblast`

The public target is `https://app.promptologoy.com/emailblast`.

A prior server checkpoint established that this host already has a **native/systemd** EmailSystem installation in `/opt/emailblast`; do not replace it with the Docker first-install path during an ordinary update. The recorded services are `emailblast-web.service` and `emailblast-worker.service`, with the web process on loopback port 3087 and PostgreSQL reachable on `127.0.0.1:55432`.

Treat that as a historical checkpoint, not proof of current live health. Before updating, re-check the services, listening ports, disk/memory, current Git SHA, protected `.env`, PostgreSQL/Redis connectivity, Nginx route/TLS and both root-site and `/emailblast` status. Preserve the current root project and back up the EmailSystem database/environment before applying migrations.

For this existing host, follow the native update path in `NATIVE_RUNTIME.md`: select the verified release commit, install locked dependencies, run `pnpm bootstrap:native:check`, build with `NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native`, apply only required repository migrations after backup, restart only the EmailSystem worker/web services, and verify loopback plus public readiness. Do not switch runtime models during the update.

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

For an existing Nginx server, include `deploy/nginx-emailblast.conf` inside the existing `app.promptologoy.com` HTTPS server block, validate with `nginx -t`, then reload Nginx. Preserve all existing locations and certificates. For a different proxy, apply an equivalent path-scoped route only after inspecting its actual configuration. Forward `/emailblast/...` unchanged; do not strip the prefix. The trusted proxy must overwrite `Host`, `X-Forwarded-Host` and incoming client-IP headers, and allow SSE responses to stream. Do not expose the loopback application port publicly or enable raw access logging for redirect paths.

Verify both the existing root project and `/emailblast/login`, authenticate with the requested account, check `/emailblast/health/ready`, provider setup, pre-flight, preview, Activity/SSE and CSV export. Sending never depends on click tracking. Do not send a live campaign as an installation health check.

`NEXT_PUBLIC_BASE_PATH` is compiled into Next.js and must equal the pathname of `APP_URL`. Rebuild when changing it. Client fetches, native links, exports and SSE include the prefix; Next navigation includes it automatically. Cookies are scoped to that path. [Next.js documents the build-time basePath behavior](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath).

For updates, use the same compose files and project name for every command. Back up the database and keys, build the selected verified commit, stop only the `emailblast` worker, apply migrations, recreate only its web/worker containers, and recheck both sites. Never run a global Docker prune or remove another project's containers/volumes. Keep the previous image and compatible backup for rollback.

## Click redirect path

Optional click tracking uses the same canonical `APP_URL` as the application: `${APP_URL}/r/<opaque-token>`. Do not add a second hostname, wildcard host routing or a third-party shortener. The supplied Nginx fragment disables access logs for `/emailblast/r/`; apply the same minimization if the existing proxy configuration is adapted. Tracking defaults off, and a direct safe destination remains direct when it is off.

## Secure provider bootstrap

Copy `.env.providers.example` to `.env.providers.local`, enter values only on the controlled VPS, set ownership so the runtime container user can read it, and set mode `0600`. Never paste values into shell arguments, Compose YAML, Git, CI, screenshots or logs. The command validates mappings before mutation; API and optional SMTP-backup fields remain distinct inside one encrypted provider record, so a backup transport does not create extra safety capacity.

```sh
cp .env.providers.example .env.providers.local
chown 1000:1000 .env.providers.local
chmod 600 .env.providers.local
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml run --rm --no-deps -v "$PWD/.env.providers.local:/app/.env.providers.local:ro" web node --import tsx scripts/providers-bootstrap.ts --dry-run --user ray@emailblast.me
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml run --rm --no-deps -v "$PWD/.env.providers.local:/app/.env.providers.local:ro" web node --import tsx scripts/providers-bootstrap.ts --apply --user ray@emailblast.me
docker compose -p emailblast -f compose.yaml -f compose.shared.yaml run --rm --no-deps -v "$PWD/.env.providers.local:/app/.env.providers.local:ro" web node --import tsx scripts/providers-bootstrap.ts --verify --user ray@emailblast.me
```

`--apply` upserts exactly eight API-primary records in disabled/unverified state and encrypts all retained credentials. `--verify` uses read-only or provider-native non-delivery checks; it never sends an ordinary email. Postmark candidates are safely probed when two server tokens are present and no selection is given; ambiguous valid candidates stop for an explicit selection. A healthy connection is not the same as a verified sender domain. Use an explicit controlled recipient in Providers → Test only when a genuine send test is authorized.

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

The user creation command reads the email and password from the terminal with password echo disabled. Providers can then be installed with the secure bootstrap above or individually through Providers → Save & Verify.

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
