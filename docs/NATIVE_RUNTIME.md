# EmailBlast native / systemd runtime

EmailBlast supports a non-Docker runtime when PostgreSQL, Redis, reverse proxying, and process supervision are already managed by the host.

The native runtime does not replace the Docker Compose deployment. Choose one runtime model per installation.

## Requirements

- Node.js 24.19+
- pnpm 11.19
- PostgreSQL 17
- Redis 7.4
- systemd or equivalent process supervisor
- HTTPS reverse proxy

## Install

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile

cp .env.example .env
chmod 600 .env
```

For production set:

- `NODE_ENV=production`;
- `APP_URL` to the exact public URL;
- `NEXT_PUBLIC_BASE_PATH` to the pathname of `APP_URL`, or blank at the domain root;
- `DATABASE_URL` and `REDIS_URL` to addresses reachable by the host processes;
- independent `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` values.

Run the environment/bootstrap checks:

```sh
pnpm bootstrap:native
```

This validates runtime versions, URLs, secret configuration, protected file permissions, PostgreSQL, Redis, and Prisma generation. It does not apply SQL migrations.

For a brand-new database only:

```sh
pnpm db:migrate
pnpm user:create
```

For an existing production database, apply migrations only when the selected release includes them and only after backup/rehearsal.

## Production build

At the domain root:

```sh
pnpm build:native
```

For a path-prefixed installation:

```sh
NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native
```

The standalone web entry point is:

```text
apps/web/.next/standalone/apps/web/server.js
```

The worker entry point is:

```text
node --import tsx apps/worker/main.ts
```

## Example systemd services

Store environment values in a protected EnvironmentFile rather than embedding credentials in unit files.

Web service example:

```ini
[Unit]
Description=EmailBlast web
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/emailsystem/apps/web/.next/standalone/apps/web
EnvironmentFile=/opt/emailsystem/.env
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Worker example:

```ini
[Unit]
Description=EmailBlast worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/emailsystem
EnvironmentFile=/opt/emailsystem/.env
ExecStart=/usr/bin/node --import tsx apps/worker/main.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Adapt paths to the actual Node installation and checkout location.

## Routine update

Use an exact verified release SHA:

```sh
cd /opt/emailsystem

git fetch origin main
git checkout --detach <verified-release-sha>

pnpm install --frozen-lockfile
pnpm bootstrap:native:check

NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native

# Apply only migrations included in the selected release, after backup:
pnpm db:migrate

systemctl restart emailsystem-worker.service
systemctl restart emailsystem-web.service
```

Do not run `git clean` blindly on a production checkout that may contain intentionally host-only ignored/untracked files.

## Health verification

Check both the loopback application and the public HTTPS route:

```sh
curl -fsS http://127.0.0.1:3000/emailblast/health/live
curl -fsS http://127.0.0.1:3000/emailblast/health/ready

curl -fsS https://mail.example.com/emailblast/health/live
curl -fsS https://mail.example.com/emailblast/health/ready
```

Adjust host, port, and base path to the installation.

Liveness only proves the web process responds. Readiness also checks PostgreSQL, Redis, and recent worker heartbeat.

## Operational notes

- changing `NEXT_PUBLIC_BASE_PATH` requires a fresh build;
- do not strip the configured base path in the reverse proxy;
- do not use `prisma db push` for production rollout;
- keep web and worker versions aligned during deployment;
- preserve the encryption key across restores;
- keep previous build/database backups until acceptance succeeds.
