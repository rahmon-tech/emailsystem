# Current work

## Verified baseline

Remote `main` is verified at `849b4c1fc5f7f09f0a9124a451817b65a5a66214` (`feat(image): preserve alt text fidelity on image replacement (#36)`). Full merged-main Quality #166 passed for that exact SHA, including fresh migrations, schema-drift and upgrade rehearsal, lint, secret scan, strict typecheck, unit tests, PostgreSQL/Redis integration tests, production build, Playwright E2E, visual-review screenshots, production-container validation, diagnostics, artifact upload, cleanup, and container shutdown.

The repository remains an existing TypeScript/pnpm application with Next.js + MUI web UI, PostgreSQL/Prisma persistence, Redis-backed safety/rate coordination, a worker process, provider adapters, an email renderer, and Docker deployment assets. Preserve this architecture; do not introduce a second campaign, delivery engine, experiment sender, provider-routing path, scheduler, tracking subsystem, or test-send path.

## Completed product foundation

The verified system currently includes:

- the primary Providers → Blast → Activity product shell;
- provider catalog/configuration, verification, encrypted credentials, sender-domain authorization, and stable sender identities;
- recipient CSV/TXT/XLSX import and persisted imports;
- rich/source HTML composition, HTML import, compatibility normalization, sandboxed desktop/mobile preview, plain-text generation, and immutable campaign snapshots;
- pre-flight checks, campaign preparation, durable delivery records, background dispatch, rate control, safety budgets, pause/resume/cancel controls, retry/reconciliation behavior, suppressions/unsubscribe, webhooks, tracking, Activity reporting, and exports already present in the current architecture;
- weighted/fair multi-provider routing, provider-specific limits/quotas/concurrency, provider-independent sender-domain pacing, account/domain/campaign ceilings, cooldowns, warm-up/soft-start, complaint/hard-bounce brakes, and fail-closed policy enforcement;
- authorized experiment profiles/runs with authorization metadata, provider/sender scopes, controlled-recipient allowlists, hard recipient/attempt/duration limits, bounded windows, account kill switch, transport reservation checks, and tamper-evident evidence/export;
- inline-vs-attachment provider message semantics and Content-ID support across SMTP, SES raw MIME, Resend, SendGrid, Postmark, Mailjet, and Mailgun, with fail-closed behavior for unsupported API transports;
- portable inline Content-ID validation capped at 127 characters and compatibility coverage for supported provider wire formats/MIME;
- the authenticated `/blast/image` Image-first composer using the existing Blast/campaign/delivery architecture;
- verified Image-first primary-image replace/remove lifecycle plus ordinary attachments sharing the authoritative five-file / 5 MB campaign attachment ceiling;
- verified Image-first test-message support through the existing `POST /test-message` API and `testProvider` owner, including sender-authorized CID-capable provider filtering and server-side fail-closed transport enforcement;
- verified Image-first CC/BCC parity through the same core campaign contract, including normalization, duplicate/list/suppression protection, copy-cost warnings, and browser payload proof;
- verified Image-first scheduling parity through the existing `scheduledAt` campaign/delivery contract, including browser-local time to ISO conversion and PostgreSQL proof that scheduled eligibility propagates unchanged to prepared deliveries;
- verified Image-first tags/tracking parity through the existing campaign tags contract, tracking settings, `trackingChoice`, snapshot rewrite, redirect, and analytics owners;
- verified Image-first inline-capability visibility that reuses the sender/provider catalog and `supportsInlineAttachmentTransport()` owner to surface eligible-versus-CID-capable transports before preview/pre-flight while preserving fail-closed server-side enforcement;
- verified Image-first alt-text replacement fidelity: filename-derived text remains automatic until a nonblank description is authored, authored text survives image replacement, and clearing the field returns it to generated provenance.

The canonical delivery-control-plane requirements remain in `docs/DELIVERY_CONTROL_PLANE.md`. They are not superseded by this Image-first correction.

## Current milestone — optional primary-image destination

A concrete post-parity UX gap was observed in the verified Image-first composer: the primary CID image could be displayed and tracked alongside other links, but it could not itself act as a clickable campaign CTA. PR #38 addresses only that gap.

The candidate behavior is deliberately narrow:

- a new optional `Image destination URL (optional)` field sits beside the existing primary-image/alt-text controls;
- an empty destination preserves the existing unlinked CID image markup;
- a valid complete `http://` or `https://` destination wraps the primary CID image in one ordinary `<a href>` element;
- because the link is ordinary campaign HTML, the existing campaign snapshot/click-tracking owner remains authoritative when tracking is enabled; no new redirect or tracking subsystem is introduced;
- invalid or non-HTTP(S) destinations, including `javascript:` URLs, surface an inline error and disable preview, pre-flight, and test-message actions;
- the destination is escaped before insertion into the HTML attribute;
- preview uses the same linked/unlinked HTML while continuing to replace the CID source with a local data URL only for browser display;
- no schema, migration, provider adapter, MIME backend, worker, dispatcher, delivery, or deployment change is part of this slice;
- automated proof uses an isolated mock provider and no live recipient or external provider.

TDD/verification evidence is explicit:

- test-only commit `0feb6ff4fbf6b9b7f00898d6b3ae764958afda8d`, exact parent `849b4c1fc5f7f09f0a9124a451817b65a5a66214`, added only the Image-first primary-link browser contract;
- Quality #169 passed migrations/schema, upgrade rehearsal, lint, secrets, strict TypeScript, unit/integration tests, and production build before the new Playwright test failed because the `Image destination URL (optional)` textbox did not exist, establishing the intended red boundary; production-container validation, diagnostics, artifact upload, cleanup, and shutdown still completed successfully for that red run;
- implementation commit `48da1bb0b50e00f5d6ef622ae28c1d3542c55105` added the optional destination field, HTTP(S) normalization, escaped anchor wrapping, and invalid-destination action gating without changing another runtime subsystem;
- full Quality #170 passed for `48da1bb0b50e00f5d6ef622ae28c1d3542c55105`, including fresh migrations, schema/drift verification, upgrade rehearsal, lint, secrets, strict TypeScript, unit/integration tests, production build, Playwright E2E, screenshots, production-container validation, diagnostics/artifacts, cleanup, and container shutdown.

This documentation checkpoint changes no runtime behavior. Publication still requires full Quality on the exact reconciled PR #38 head, confirmation that remote `main` remains at the expected verified parent, guarded exact-head merge, and merged-main Quality on the resulting SHA.

## Parallel control-plane work

Draft PR #37 (`feat/experiment-concurrency-binding`) remains a separate, unmerged delivery-control-plane milestone. PR #38 was intentionally branched from verified `main` and does not modify PR #37. Do not mix the two histories. After this Image-first correction is published, PR #37 must reconcile against the then-current `main` before its own publication sequence continues.

## Image-first parity boundary

The planned Image-first parity sequence is complete through primary-image/attachment lifecycle, test message, CC/BCC, scheduling, tags/tracking, inline-capability visibility, alt-text replacement fidelity, plus this concrete observed primary-image CTA correction. Do not invent further Image-first slices without reconciling a specific gap from current tests, UX, or supported-provider behavior.

No live recipient or external provider may be used for automated parity proof.

## Delivery-control-plane follow-on

Resume the dedicated control-plane gap from repository truth rather than rebuilding existing routing:

- bind approved experiment pacing/concurrency/encoding/content variables into existing dispatcher/provider-rendering owners;
- ensure production/account/domain/provider safety ceilings remain authoritative and experiments can only vary behavior inside their authorized envelope;
- record effective applied experiment values and derived pacing state in tamper-evident evidence;
- add explicit temporary-failover-versus-policy-stop proof;
- finish provider effective-rate/pressure/recovery telemetry and restart-durability proof;
- add privacy/retention controls and final experiment Activity/UX/export polish.

Experiments must never silently route around a provider policy/enforcement decision.

## Later dependencies

After the dedicated delivery-control-plane completion slices:

- reusable message/template workflow if repository truth still lacks a persisted template/library abstraction;
- remaining campaign/Activity operational gaps found by current tests and UX review, especially progress/control/export fidelity under real worker states;
- final security, concurrency, performance, provider-resilience, deployment-readiness, and VPS reconciliation before production installation.

The existing non-Docker installation path remains valid; Image-first work does not impose a new deployment method. Do not claim production VPS deployment complete until the live target is actually reconciled and verified. Do not add live delivery tests without an explicitly authorized recipient/action.
