FROM node:24.19.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm db:generate && pnpm --filter @emailsystem/web build
RUN mkdir -p apps/web/.next/standalone/apps/web/.next \
    && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
    && rm -rf apps/web/.next/cache

# Install only production dependencies for the worker, migrations, and health checks.
# The worker is TypeScript at runtime, so tsx is installed explicitly here instead
# of keeping every development dependency in the production image.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --prod \
    && pnpm add --prod --ignore-workspace-root-check tsx@4.23.13

FROM node:24.19.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

# Keep only what production actually executes. Do not copy the build workspace,
# Playwright, TypeScript, ESLint, Turbopack cache, or other development artifacts.
# Copy Next's traced runtime first, then overlay the production dependency tree so
# worker-only runtime packages such as tsx are not hidden by standalone node_modules.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/worker ./apps/worker
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts/worker-health.ts ./scripts/worker-health.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
