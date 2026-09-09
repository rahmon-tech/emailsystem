# Current work

## Verified baseline

The UI refinement in PR #4 is merged. Remote main was verified at `be5fb6a3f1c59d703616b2e9484fd4dd4ac7790f`; CI [34296982470](https://github.com/rahmon-tech/emailsystem/actions/runs/34296982470) passed all 175 tests plus migrations, upgrade rehearsal, production build and container readiness. Its desktop/mobile visual review is complete.

## HTML Fidelity & Multi-Domain Branded Tracking

The seven additional acceptance requirements are implemented in the existing renderer, pre-flight, campaign, redirect, worker and MUI interfaces. No separate delivery architecture or third-party shortener was introduced. Supported safe Outlook fallbacks survive; normalization is deterministic and preserves legitimate copy/layout. Link reputation has explicit clean/blocked/unknown states and deadlines. Tracking defaults off, uses explicitly selected owned/verified hostnames, stores opaque campaign-level links and only daily visit aggregates, and never changes delivery truth. See ARCHITECTURE.md and SECURITY.md for boundaries and retention.

The full preceding tracking prompt was not recoverable from available conversation/file context. This implementation follows the visible seven requirements and existing repository contract; no missing requirement is claimed verified and no reputation-bypass rotation was inferred.

Local type checks, lint, unit tests and a production build with `/emailblast` are being verified. New real PostgreSQL integration coverage tests tenancy, default-off/strict-policy behavior, duplicate submission, redirect boundaries, scanner isolation, retention and concurrent domain disable. Browser acceptance compares original/normalized templates and exercises the existing full app journey at the requested subpath. Exact-commit CI, screenshot review and merge results will be recorded in the milestone PR.

## Deployment target and access

Authorized target: `https://app.promptologoy.com/emailblast`, alongside existing VPS projects. The shared-host compose override binds only an isolated loopback web port; the scoped Nginx snippet preserves the existing root project. Next build/runtime path configuration, cookies, APIs, navigation, SSE, exports, health, webhooks and unsubscribe links include the prefix. The app account is `ray@emailblast.me`; credentials are never stored in the repository.

Actual VPS installation and account creation are pending a working authorized remote connection. The workspace TCP attempt to the supplied server on SSH port 22 returned `Network is unreachable`. Remote Desktop Commander was suggested as an available connection option. No server changes, certificate issuance or live provider sends have occurred. Finish all code/CI work first; inspect the actual VPS and existing proxy before installation. Do not treat the checked-in configuration as deployment evidence.
