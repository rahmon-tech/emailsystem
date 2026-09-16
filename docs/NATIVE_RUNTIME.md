# Native / systemd runtime

EmailSystem supports a non-Docker runtime with PostgreSQL and Redis supplied by the host or another managed service. This path is useful on an existing VPS where the web and worker processes are supervised by systemd and the public reverse proxy is already managed separately.

The native path does **not** replace the Docker Compose deployment. Choose one runtime model per installation and keep its database, Redis, proxy and process ownership explicit.

## Fresh native checkout

Requirements: Node 24.19+ (the repository floor is 22.12), pnpm 11.19, PostgreSQL 17 and Redis 7.4.

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

Edit `.env` before continuing:

- set `NODE_ENV=production` on a production host;
- set `APP_URL` to the exact public URL, including a path prefix such as `/emailblast` when used;
- make `NEXT_PUBLIC_BASE_PATH` exactly match the pathname of `APP_URL`;
- set `DATABASE_URL` and `REDIS_URL` to addresses reachable from the native host process (for example `127.0.0.1` for host-local services);
- generate `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` independently with `openssl rand -hex 32`;
- keep provider secrets outside Git and out of shell arguments.

Run the native bootstrap:

```sh
pnpm bootstrap:native
```

The command checks the repository-pinned Node/pnpm versions, validates the runtime URL/base-path/secrets, checks production `.env` permissions, verifies PostgreSQL with `SELECT 1`, verifies Redis with `PING`, and generates the Prisma client. It does **not** apply SQL migrations and does not create a user.

For a brand-new empty database only, apply the repository migrations explicitly and create the first user:

```sh
pnpm db:migrate
pnpm user:create
```

Do not treat `pnpm db:migrate` as a routine restart/update command. For an existing production database, run it only when the selected release intentionally contains a required migration and after the normal backup/rehearsal checks.

## Native production build

Build with the same path prefix that the public application uses:

```sh
NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native
```

`build:native` runs the normal production build and then packages the current `.next/static` browser assets (plus `apps/web/public` when present) beside the Next.js standalone server. This is required for a standalone systemd runtime: serving new HTML with stale or missing browser chunks can leave the page visible while React controls do not hydrate.

The resulting web entry point is:

```text
apps/web/.next/standalone/apps/web/server.js
```

A typical systemd web service should use the standalone application directory as its working directory and start that generated `server.js`. The worker remains the existing worker entry point:

```text
node --import tsx apps/worker/main.ts
```

Keep environment values in a protected EnvironmentFile or equivalent systemd environment source. Do not place credentials directly in unit command lines.

## Routine native update

Select an exact verified release commit, preserve the existing `.env` and provider-secret files, then:

```sh
pnpm install --frozen-lockfile
pnpm bootstrap:native:check
NEXT_PUBLIC_BASE_PATH=/emailblast pnpm build:native
systemctl restart emailblast-worker
systemctl restart emailblast-web
```

`bootstrap:native:check` performs the runtime/service checks but skips Prisma generation; `build:native` generates Prisma as part of the normal build. Neither command applies SQL migrations.

After restart, verify both loopback and public readiness. For a path-prefixed installation such as Promptologoy:

```sh
curl -fsS http://127.0.0.1:3087/emailblast/health/live && echo
curl -fsS http://127.0.0.1:3087/emailblast/health/ready && echo
curl -fsS https://app.promptologoy.com/emailblast/health/ready && echo
```

Liveness only proves that the web process responds. Readiness also checks PostgreSQL, Redis and a recent worker heartbeat.

## Native troubleshooting

- HTML renders but menus/buttons do not react or a page remains on skeletons: verify the standalone runtime contains the current `apps/web/.next/static` output. Re-run `pnpm build:native` rather than manually mixing an old standalone server with new static assets.
- `bootstrap:native` warns about `postgres` or `redis` hostnames: those are normally Compose service names. A native host process usually needs a host-resolvable address such as `127.0.0.1` or a managed-service hostname.
- readiness fails while liveness succeeds: inspect the worker, PostgreSQL and Redis before changing Nginx.
- changing `NEXT_PUBLIC_BASE_PATH` requires a fresh web build; do not strip that prefix in the reverse proxy.
- never use `prisma db push` for production deployment.
