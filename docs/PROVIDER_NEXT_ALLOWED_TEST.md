# Provider next-allowed test boundary

This branch is intentionally test-only. It defines two scheduling invariants before implementation:

- a temporary/rate-limit outcome must never shorten a later provider cooldown established concurrently;
- when all sender-authorized providers are temporarily cooling down, the campaign safety wait should target the real earliest provider cooldown instead of a generic polling delay.

No production source, schema, migration, provider adapter, renderer, worker, deployment, Vercel, VPS, or external-provider behavior is changed on this branch.
