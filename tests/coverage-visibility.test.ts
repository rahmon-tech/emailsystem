import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("critical coverage stays visible without arbitrary percentage gates", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const unit = pkg.scripts["test:coverage"] ?? "";
  const integration = pkg.scripts["test:integration:coverage"] ?? "";

  for (const command of [unit, integration]) {
    assert.match(command, /--experimental-test-coverage/);
    assert.match(command, /packages\/core\/src\/\*\*\/\*\.ts/);
    assert.match(command, /packages\/providers\/src\/\*\*\/\*\.ts/);
    assert.match(command, /packages\/email\/src\/\*\*\/\*\.ts/);
    assert.doesNotMatch(
      command,
      /--test-coverage-(?:lines|branches|functions)(?:=|\s)/,
    );
  }

  assert.equal(
    pkg.scripts["coverage:critical"],
    "pnpm test:coverage && pnpm test:integration:coverage",
  );

  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /pnpm test:coverage \| tee test-results\/coverage\/unit\.txt/);
  assert.match(
    workflow,
    /pnpm test:integration:coverage \| tee test-results\/coverage\/integration\.txt/,
  );
  assert.match(workflow, /path:\s*\|[\s\S]*test-results\//);
});
