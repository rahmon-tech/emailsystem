import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const userFacingFiles = [
  ...tsxFiles(resolve(root, "apps/web/components")),
  ...tsxFiles(resolve(root, "apps/web/app")),
];

test("user-facing web copy does not regress to system-oriented wording", () => {
  const source = userFacingFiles
    .map((path) => readFileSync(path, "utf8"))
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
    "Provider accepted",
    "provider accepted",
    "non-delivery test mode",
    "Run Non-Delivery Test",
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
