import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());

const userFacingFiles = [
  "apps/web/components/shell.tsx",
  "apps/web/components/providers.tsx",
  "apps/web/components/blast.tsx",
  "apps/web/components/image-blast.tsx",
  "apps/web/components/activity.tsx",
  "apps/web/components/activity-pacing.tsx",
  "apps/web/components/activity-provider-status.tsx",
  "apps/web/components/sending-safety.tsx",
  "apps/web/components/sender-settings.tsx",
  "apps/web/components/tracking-settings.tsx",
  "apps/web/components/provider-pacing-panel.tsx",
  "apps/web/components/image-test-message.tsx",
];

test("user-facing web copy does not regress to system-oriented wording", () => {
  const source = userFacingFiles
    .map((path) => readFileSync(resolve(root, path), "utf8"))
    .join("\n");

  for (const phrase of [
    "Dispatch pace",
    "Current pace",
    "Estimated remaining",
    "Live provider availability",
    "transport slot",
    "sender authorization",
    "Normal pace",
    "Domains & aliases",
    "Sending safety",
    "Run pre-flight",
    "Pre-flight",
    "Add provider",
  ])
    assert.equal(
      source.includes(phrase),
      false,
      `User-facing phrase should stay simplified: ${phrase}`,
    );
});

test("all MUI menus inherit bounded contained scrolling on mobile", () => {
  const theme = readFileSync(
    resolve(root, "apps/web/components/theme.tsx"),
    "utf8",
  );
  assert.match(theme, /MuiMenu:\s*\{/);
  assert.match(theme, /maxHeight:\s*"min\(320px, calc\(100dvh - 96px\)\)"/);
  assert.match(theme, /overflowY:\s*"auto"/);
  assert.match(theme, /overscrollBehavior:\s*"contain"/);
  assert.match(theme, /WebkitOverflowScrolling:\s*"touch"/);
});
