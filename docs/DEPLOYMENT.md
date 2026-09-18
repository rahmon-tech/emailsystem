# Production deployment

EmailSystem supports both Docker Compose and native/systemd production installations. Choose one runtime model per installation and keep database, Redis, reverse proxy, backups, and process ownership explicit.

## Production requirements

- Linux host
- Node.js 24.19+ for native deployments
- pnpm 11.19
- PostgreSQL 17
- Redis 7.4
- HTTPS reverse proxy
- a public application URL
- verified provider sending domains and credentials

Generate `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` independently. Store them outside Git and preserve them across restores.

## Environment

Start from the example:

```sh
cp .env.example .env
chmod 600 .env
```

For production, set at least:

```dotenv
NODE_ENV=production
APP_URL=https://mail.example.com
NEXT_PUBLIC_BASE_PATH=
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SESSION_SECRET=...
CREDENTIAL_ENCRYPTION_KEY=...
```

If the application is mounted below a path such as `/emailblast`, `APP_URL` must include that path and `NEXT_PUBLIC_BASE_PATH` must exactly match it. Changing the base path requires a fresh web build.

## Docker Compose installation

From a clean checkout:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile

cp .env.example .env
chmod 600 .env
# Edit .env before continuing.

docker compose config --quiet
docker compose build
docker compose up -d postgres redis

docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose run --rm -it web node --import tsx scripts/create-user.ts

docker compose up -d --wait web worker proxy
```

Then verify:

```sh
curl --fail https://mail.example.com/health/live
curl --fail https://mail.example.com/health/ready
```

Liveness proves that the web process responds. Readiness also checks PostgreSQL, Redis, and a recent worker heartbeat.

## Native/systemd installation

For an existing host that already manages PostgreSQL, Redis, systemd, and reverse proxying, use [NATIVE_RUNTIME.md](NATIVE_RUNTIME.md).

Do not switch a working installation from native/systemd to Docker, or the reverse, as part of an ordinary application upgrade.

## Reverse proxy

The application must be served over HTTPS in production. Preserve the configured base path and forward it unchanged to the application.

The proxy should:

- overwrite `Host` and `X-Forwarded-Host`;
- overwrite client-IP forwarding headers rather than trusting arbitrary incoming values;
- allow Server-Sent Events to stream;
- avoid exposing the application loopback port publicly;
- minimize or disable access logging for click-redirect routes where privacy policy requires it.

Example Caddy and Nginx files are available in `deploy/`.

## Provider bootstrap

Provider credentials can be installed interactively in the UI. For controlled server-side bootstrap, copy:

```sh
cp .env.providers.example .env.providers.local
chmod 600 .env.providers.local
```

Populate it only on the controlled host. Never commit it or paste credentials into shell history, CI configuration, screenshots, or issue reports.

A dry run should be performed before applying values:

```sh
export ADMIN_EMAIL="admin@example.com"

docker compose run --rm --no-deps \
  -v "$PWD/.env.providers.local:/app/.env.providers.local:ro" \
  web node --import tsx scripts/providers-bootstrap.ts --dry-run --user "$ADMIN_EMAIL"
```

Apply and verify only after reviewing the dry-run output.

## Upgrades

Before every production upgrade:

1. record the current Git SHA;
2. back up PostgreSQL;
3. back up the protected environment and encryption keys separately;
4. select the exact release SHA to deploy;
5. install locked dependencies;
6. run the relevant environment checks;
7. build the selected release;
8. apply only repository migrations included in that release;
9. restart web and worker processes together;
10. verify liveness and readiness.

For Docker Compose:

```sh
git fetch origin main
git checkout --detach <verified-release-sha>

docker compose build
docker compose stop worker
docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
docker compose up -d --force-recreate web worker proxy

curl --fail https://mail.example.com/health/live
curl --fail https://mail.example.com/health/ready
```

Do not use `prisma db push` in production.

## Database backup

Example Docker backup:

```sh
mkdir -p backups
chmod 700 backups

docker compose exec -T postgres \
  pg_dump -U emailsystem -d emailsystem -Fc \
  > "backups/emailsystem-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Encrypt backups and copy them off-host. Backups contain recipient and message data and must be handled as sensitive information.

The same `CREDENTIAL_ENCRYPTION_KEY` is required to decrypt stored provider credentials after restore. Keeping the same `SESSION_SECRET` also preserves existing signed unsubscribe links.

## Restore rehearsal

Restore tests belong on an isolated host or isolated database, never directly over production.

After restore:

- use the restored encryption/session keys;
- apply repository migrations;
- clear or rebuild stale Redis coordination state as appropriate;
- start web and worker processes;
- verify liveness/readiness;
- use mock or isolated provider accounts for recovery testing.

Do not run a restored test installation against the same live sending accounts as production.

## Rollback

Keep the previously deployed Git SHA, application build/image, database backup, and environment backup until the new release has passed acceptance.

Application rollback may be possible by returning to the previous build. Database migrations are forward changes and may require restoring a compatible backup; they are not automatically reversible.

## Production acceptance

After deployment verify:

- login;
- Sending services;
- provider connection health;
- campaign pre-flight;
- preview;
- worker readiness;
- Activity/SSE;
- export;
- webhook reachability for configured providers.

Do not send a normal live campaign merely as a health check. Use an explicitly controlled provider test recipient when live delivery verification is required.
