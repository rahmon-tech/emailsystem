# Implementation and verification report

This report separates repository/CI proof from live provider and deployment-host proof.

## Current published checkpoint

Published `main` is exactly:

`128ba739299db8e3caad3599df9dd7dddfe437c6`

PR #87 introduced the final domain-first sender/provider/capacity/mobile-UX reconciliation.

Quality #383 passed on the exact PR head. Push-triggered Quality #384 / run `35333756671` then passed on the exact same published `main` SHA.

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

## Verified domain-first behavior

Repository tests now prove:

- provider configuration owns a sending domain and a bounded alias pool;
- provider connection daily/monthly capacity is persisted and enforced;
- multiple eligible connections on the same selected domain contribute capacity independently;
- providers authorized only for another domain do not leak into that domain's campaign pool;
- shared account/domain/campaign ceilings can impose stricter limits but are blank by default;
- sender-domain short-window pacing coordinates the aggregate eligible connection rate rather than collapsing all connections to the lowest sibling limit;
- warm-up/adaptive pressure can still lower effective pace;
- non-experiment delivery alias assignment is deterministic per delivery and retries keep a stable assignment;
- alias selection never widens provider authorization;
- address-specific authorization cannot be bypassed by another alias;
- experiment-bound campaigns remain pinned to their approved sender identity;
- recipient-import menus have bounded independent scrolling;
- touch/mobile editor text and toolbar behavior avoid focus zoom/width wobble;
- standard Blast and Image-first use the same domain-first sending contract.

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

Development/publication acceptance is satisfied by exact published `main` SHA `128ba739299db8e3caad3599df9dd7dddfe437c6` and push-triggered Quality #384 / run `35333756671`.

The remaining work is live environment/provider acceptance: update the existing native/systemd installation, verify persistence/migrations/process supervision/reverse proxy/TLS/readiness, then verify real provider/domain/webhook behavior with a tightly controlled legitimate smoke test.
