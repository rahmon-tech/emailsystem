# Implementation and verification report

This report separates repository/CI proof from live provider and deployment-host proof.

## Current published checkpoint

Published `main` is exactly:

`4b33adaa24cff03940ffddd2642b2a170481d844`

PR #89 introduced multi-domain campaign pools, route-aware failover/capacity, safer retry/resume behavior and the user-first mobile/provider/Activity UX reconciliation.

Quality #455 / run `35363742131` passed on the exact merged `main` SHA.

The successful pipeline covered:

- locked dependency installation;
- high/critical production dependency audit;
- Prisma generation;
- fresh PostgreSQL migrations;
- migration/schema drift verification;
- upgrade rehearsal;
- lint;
- repository secret scan;
- strict TypeScript;
- unit tests;
- PostgreSQL/Redis integration tests;
- production Next.js build;
- Playwright Chromium/browser E2E;
- screenshot/visual review emission;
- production-container validation;
- diagnostics/artifact handling and teardown.

## Verified sending-pool behavior

Repository tests now prove:

- provider configuration owns a sending domain and bounded From-address pool;
- standard and Image-first campaigns can select multiple verified domains while preserving single-domain compatibility;
- only currently viable domain/From-address/sending-service routes enter the active campaign pool;
- disabled or terminally broken connections can be skipped while healthy selected routes continue;
- controlled experiments remain pinned to their approved sender and fail closed on provider policy enforcement;
- provider connection daily/monthly capacity is persisted and enforced;
- independent eligible connections contribute configured capacity additively;
- shared account/domain/campaign rolling-24-hour and monthly ceilings can impose stricter limits;
- live resume/retry checks use current route availability rather than stale campaign assumptions;
- manual retry requeues only definitively FAILED deliveries and leaves UNKNOWN/already accepted outcomes untouched;
- address-specific authorization cannot be widened through another From address;
- recipient/menu dropdowns use bounded independent scrolling on mobile;
- the mobile workspace header remains sticky;
- user-facing web copy is regression-tested against internal system-oriented terminology;
- provider delivery-update setup supports the URL-first, signing-key-second flow.

## Delivery truth

Generic SMTP verification proves DNS/TLS/authentication and server acceptance capability only. Without a provider-specific event source, final delivery remains unconfirmed.

Provider webhooks/events remain the authoritative path for delivery/bounce/complaint confirmation where supported. A green repository test does not prove that a real provider account currently has working credentials, verified sender/domain state, production quota or reachable webhook configuration.

## Deployment truth

The last recorded VPS checkpoint predates this published release and used the native/systemd runtime in `/opt/emailblast`.

That checkpoint showed:
- `emailblast-web.service` and `emailblast-worker.service` active;
- web listening on loopback port 3087 after startup;
- PostgreSQL reachable at `127.0.0.1:55432`;
- migrations applied;
- readiness returning `{"status":"ready"}`.

The live host must still be re-inspected before applying this release. Repository CI does not prove current Nginx/TLS health, process state, backups, provider credentials or live webhooks.

## Intentionally unclaimed behavior

`text`, `hosted-image`, `attachment-only` and `image-dominant` remain experiment metadata only. They are not reported as effective runtime behavior without a deterministic existing runtime owner.

## Acceptance boundary

Development/publication acceptance is satisfied by exact published `main` SHA `4b33adaa24cff03940ffddd2642b2a170481d844` and Quality #455 / run `35363742131`.

The remaining work is live environment/provider acceptance: update the existing native/systemd installation, verify persistence/migrations/process supervision/reverse proxy/TLS/readiness, then verify real sending-domain/delivery-update behavior with a tightly controlled legitimate smoke test.
