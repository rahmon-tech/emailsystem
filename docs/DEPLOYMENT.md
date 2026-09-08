# VPS deployment

## First installation

Use a Linux VPS with Docker Engine and the Compose plugin, a domain pointing to its public IP, and ports 80/443 open. Allow memory for both Next.js builds and PostgreSQL; 4 GB is a practical starting allocation. Verify the domain's DNS and provider sending-domain records separately.

```sh
git clone --branch codex/emailsystem-platform https://github.com/rahmon-tech/emailsystem.git
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

The user creation command reads the email and password from the terminal; the current CLI clearly labels visible password input. Avoid screen recording or shared terminals during account creation. Provider keys are subsequently entered through Providers → Save & Verify.

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
