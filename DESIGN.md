# EmailBlast — DESIGN.md

Status: v1 design direction (incremental migration)
Scope: apps/web, not delivery workers or provider logic
Reference: Linear-inspired product clarity, adapted to EmailBlast's existing LIGHT MUI palette. Do not copy Linear branding or switch to its dark marketing theme.

## Product principles

1. Operational confidence over decoration. Campaign state, eligibility, provider health, and next actions must be instantly legible.
2. Density with breathing room. Favor clear rows, grouped fields, and compact actions over oversized cards and large blank areas.
3. One primary action per view. Secondary actions use quiet outlined/text treatments. Destructive actions require explicit confirmation.
4. Mobile is a first-class workflow. Critical tasks must be executable at 320px+ without horizontal page scrolling, browser zoom traps, or hidden actions.
5. Behaviors and wording remain truthful. Transport acceptance is **not** delivery. Never rename ambiguous/UNKNOWN states to delivered, automatically retry uncertain sends, or suppress safety alerts.
6. No unnecessary visual noise: avoid excessive rounded corners, pill-shaped panels, gradients, heavy shadows, noisy KPI tiles, animated backgrounds, and duplicate action bars.
7. Incrementally improve existing React/MUI components and shared dialogs; do not replace working server actions, routing, editor behavior, forms, validation, or polling to obtain a new appearance.

## Tokens

These are design targets; existing MUI tokens remain canonical until components migrate.

| Token | Value | Application |
| --- | --- | --- |
| Canvas | #F7F8FA | Workspace background |
| Surface | #FFFFFF | Sidebar, header, forms, elevated content |
| Primary | #465ACB | Selected nav, CTA, focus accent |
| Primary dark | #3446A5 | Active CTA |
| Ink | #202633 | Main body and headings |
| Secondary | #646C7B | Supporting descriptions |
| Divider | #E8EBF0 | Hairline separation |
| Hover | #F3F5F9 | Hover rows |
| Selected | #EDF0FB | Active navigation |
| Positive | #23795B | Confirmed successful states only |
| Caution | #955E12 | Risk/uncertainty/waiting |
| Error | #BD4350 | Failure and destructive actions |
| Base spacing | 4px | Use 4/8/12/16/24/32/48 steps |
| Small radius | 6–8px | Inputs, actions, small tiles |
| Panel radius | 10–12px | Main cards/dialogs |
| Default shadow | hairline or subtle low elevation | Never pile elevated cards |
| Sidebar width | 232px desktop | Navigation must feel stable |
| Content width | maximum 1360px | Avoid very wide forms, preserve working area |

Typography: system font stack already present in apps/web/components/theme.tsx; 14px base UI, 12–13px metadata, 18–22px page headings, 26–30px primary headings when warranted. Boldness distinguishes hierarchy; avoid giant headings competing with controls.

## Information architecture

- **Create campaign**: imports and recipients, message, sender, preflight, schedule/test/send. Preserve standard and image-first modes, saved items, editor, and validation.
- **Sending services**: provider connections, verified senders and domains, routing, safety, tracking, pacing. Group related settings; don't visually hide security and authorization checks.
- **Activity**: campaign progress, counts, states, provider availability, pacing, event log, retry/pausing controls, and exports. Make uncertainty and suppression visible and understandable.
- **Account**: compact top-right menu with current identity and sign out.
- Navigation is three stable destinations; page title and breadcrumb are contextual, not duplicated as another giant nav.

## Core component rules

- Navigation: compact text/icon rows, selected indicator and accessible aria-current; mobile uses a dismissible drawer with the same destinations.
- Header: 60–64px, current location on left, compact account control on right. A contextual "New campaign" shortcut is permissible when not already composing.
- Page titles: title + one meaningful description at most; align the primary action inline on wider screens and allow natural reflow on phones.
- Action buttons: 40–44px targets, 8px radius, concise labels; never full-width unless a mobile action genuinely benefits from it.
- Form controls: visible labels, clear helper/error text, 44px min touch height; mobile text inputs >=16px to avoid iOS Safari focus zoom.
- Cards: group by task, not by each individual data item. Avoid card-inside-card repetition.
- Lists/tables: separate rows with fine lines; on narrow viewports present stacked key/value rows rather than forcing wide horizontal scrolling for primary tasks.
- Statuses: textual status plus semantic color/icon. All safety-important distinctions remain intact. Color alone must never carry meaning.
- Shared dialogs: ResponsiveDialog is the canonical shell. Desktop uses constrained width; mobile is full-height only for complex editing flows. Consistent title, close affordance, body scroll and action footer.
- Compose/editor: keep desktop preview, phone preview, HTML source mode, attachments, and image-first sending visible without turning the screen into a wizard with too many steps.
- Motion: 120–180ms for simple affordances; respect reduced-motion preferences. Never delay interactions for decorative loading.

## Responsive contract

- >=1200px: fixed left navigation, flexible work area. Avoid excessive fixed-size central blocks.
- 900–1199px: narrow sidebar, work area can split into two columns when content merits it.
- <900px: navigation drawer; preserve app bar and current-page context.
- <600px: single main column, 16px outside padding, controls flow/wrap rather than clip; account control remains usable.
- 320–375px acceptance: no horizontal viewport overflow, clipped form actions, or non-dismissable modal. Maintain safe-area bottom padding.
- Reduced bandwidth and lower-power devices: avoid unnecessary media fetches, long-running animation, or re-rendering editor views on unrelated status updates.

## Incremental rollout

1. **Foundation** — design spec, shell/navigation polish, responsive regression checks.
2. **Sending services** — group connections, sender authorization, health, pacing, safety into a coherent hierarchy.
3. **Create campaign** — recipients/composition/preflight hierarchy, compact actions, standard and image-first parity.
4. **Activity** — state-first operational view with honest acceptance/delivery semantics, actionable logs, safe controls.
5. **Cross-screen QA** — mobile 320/375/390/768, desktop 1024/1440, keyboard, VoiceOver, dark/high-contrast browser preferences, reduced-motion, loading/error/empty states.

## Functional invariants

Never change campaign lifecycle, idempotency, recipient import/suppression rules, provider authorization, delivery retry semantics, or worker orchestration as part of a cosmetic pass. UI refactors must not change API payloads or underlying rate policies. Preserve current authentication, routing, session refresh, and provider setup.

## Verification gates

- pnpm lint, pnpm typecheck, pnpm build
- Run pertinent Playwright smoke tests and capture desktop/mobile screenshots
- Ensure no session or provider changes, especially for "UNKNOWN" delivery state
- Verify keyboard navigation, focus visibility, modal dismissal, touchscreen target sizes, and no 320px overflow
- Require PR review before merging or deployment; never promote a design-only branch without CI and screenshot QA
