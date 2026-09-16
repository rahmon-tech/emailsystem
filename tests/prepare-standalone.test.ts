import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareStandalone } from "../scripts/prepare-standalone.ts";

test("prepareStandalone copies current static and public assets beside the standalone server", async () => {
  const root = await mkdtemp(join(tmpdir(), "emailsystem-standalone-"));
  try {
    const web = join(root, "apps/web");
    const standalone = join(web, ".next/standalone/apps/web");
    await mkdir(join(web, ".next/static/chunks"), { recursive: true });
    await mkdir(standalone, { recursive: true });
    await mkdir(join(web, "public"), { recursive: true });
    await writeFile(join(standalone, "server.js"), "server");
    await writeFile(join(web, ".next/static/chunks/app.js"), "fresh-js");
    await writeFile(join(web, "public/logo.txt"), "logo");
    await mkdir(join(standalone, ".next/static/chunks"), { recursive: true });
    await writeFile(join(standalone, ".next/static/chunks/app.js"), "stale-js");

    await prepareStandalone(root);

    assert.equal(
      await readFile(join(standalone, ".next/static/chunks/app.js"), "utf8"),
      "fresh-js",
    );
    assert.equal(await readFile(join(standalone, "public/logo.txt"), "utf8"), "logo");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepareStandalone fails closed when standalone server output is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "emailsystem-standalone-missing-"));
  try {
    await mkdir(join(root, "apps/web/.next/static"), { recursive: true });
    await assert.rejects(
      prepareStandalone(root),
      /Standalone server output is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
