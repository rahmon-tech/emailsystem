import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import {
  createDockerEnvironment,
  validateBasePath,
  validateInstallDomain,
} from "../scripts/setup-env";
import { dockerInstallPlan } from "../scripts/install-docker";

test("installer validates a public hostname and optional base path", () => {
  assert.equal(validateInstallDomain(" Mail.Example.COM "), "mail.example.com");
  assert.equal(validateBasePath("/emailblast"), "/emailblast");
  assert.equal(validateBasePath(""), "");
  assert.deepEqual(
    dockerInstallPlan("mail.example.com", "/emailblast"),
    {
      domain: "mail.example.com",
      basePath: "/emailblast",
      appUrl: "https://mail.example.com/emailblast",
    },
  );
  assert.throws(() => validateInstallDomain("localhost"));
  assert.throws(() => validateInstallDomain("https://mail.example.com"));
  assert.throws(() => validateBasePath("emailblast"));
  assert.throws(() => validateBasePath("/emailblast/"));
});

test("environment generator creates protected independent production secrets and never overwrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emailblast-install-"));
  const destination = join(dir, ".env");
  try {
    const result = await createDockerEnvironment(
      "mail.example.com",
      "/emailblast",
      destination,
    );
    assert.equal(result.appUrl, "https://mail.example.com/emailblast");
    const raw = await readFile(destination, "utf8");
    const env = parse(raw);
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.APP_URL, "https://mail.example.com/emailblast");
    assert.equal(env.NEXT_PUBLIC_BASE_PATH, "/emailblast");
    assert.equal(env.DOMAIN, "mail.example.com");
    assert.match(env.SESSION_SECRET ?? "", /^[a-f0-9]{64}$/);
    assert.match(env.CREDENTIAL_ENCRYPTION_KEY ?? "", /^[a-f0-9]{64}$/);
    assert.notEqual(env.SESSION_SECRET, env.CREDENTIAL_ENCRYPTION_KEY);
    assert.match(env.POSTGRES_PASSWORD ?? "", /^[a-f0-9]{64}$/);
    assert.equal(
      env.DATABASE_URL,
      "postgresql://emailsystem:" +
        env.POSTGRES_PASSWORD +
        "@postgres:5432/emailsystem",
    );
    if (process.platform !== "win32")
      assert.equal((await stat(destination)).mode & 0o777, 0o600);
    await assert.rejects(() =>
      createDockerEnvironment(
        "mail.example.com",
        "/emailblast",
        destination,
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
