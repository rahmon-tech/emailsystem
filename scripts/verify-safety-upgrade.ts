import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";
const baseline = "846c2887bf72e7b84003b0d49a55eba498f69faa";
const base = new URL(process.env.DATABASE_URL!);
const database = "safety_upgrade_" + crypto.randomUUID().replaceAll("-", "");
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
const temp = mkdtempSync(join(tmpdir(), "emailsystem-upgrade-"));
const config = resolve("safety-upgrade-" + crypto.randomUUID() + ".config.ts");
base.pathname = "/" + database;
const env = {
  ...process.env,
  DATABASE_URL: base.toString(),
  CHECKPOINT_DISABLE: "1",
};
const prisma = (...args: string[]) =>
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", ...args],
    { env, stdio: "inherit" },
  );
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  const paths = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      baseline,
      "packages/db/migrations",
      "packages/db/schema.prisma",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const path of paths) {
    const target = join(temp, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["show", baseline + ":" + path]));
  }
  writeFileSync(
    config,
    `import { defineConfig } from 'prisma/config'; export default defineConfig({schema:${JSON.stringify(join(temp, "packages/db/schema.prisma"))},migrations:{path:${JSON.stringify(join(temp, "packages/db/migrations"))}},datasource:{url:process.env.DATABASE_URL!}});`,
  );
  prisma("migrate", "deploy", "--config", config);
  const client = new Client({ connectionString: base.toString() });
  await client.connect();
  try {
    await client.query(`INSERT INTO "User" (id,email,"passwordHash") VALUES ('upgrade-user','upgrade@example.com','fixture');
      INSERT INTO "ProviderConnection" (id,"userId",name,type,transport,settings,credentials,"credentialHint","updatedAt") VALUES ('upgrade-provider','upgrade-user','Fixture','mock','api','{}','{}','fixture',now());
      INSERT INTO "Campaign" (id,"userId",name,message,"importId","startKey","updatedAt") VALUES ('upgrade-campaign','upgrade-user','Fixture','{"from":"sender@example.com","cc":["audit@example.com"],"bcc":["archive@example.com"]}','fixture','fixture',now());
      INSERT INTO "Delivery" (id,"userId","campaignId",email,"unsubscribeToken","unsubscribeHash","updatedAt") VALUES ('upgrade-delivery','upgrade-user','upgrade-campaign','recipient@example.net','token','hash',now());
      INSERT INTO "DeliveryAttempt" (id,"userId","deliveryId","providerId","providerRevision","idempotencyKey",state) VALUES ('upgrade-attempt','upgrade-user','upgrade-delivery','upgrade-provider',1,'fixture','UNKNOWN');`);
    prisma("migrate", "deploy");
    prisma(
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "packages/db/schema.prisma",
      "--exit-code",
    );
    const {
      rows: [row],
    } = await client.query(
      `SELECT state,"messageUnits","senderDomain","startedAt"="transmissionStartedAt" AS retained FROM "DeliveryAttempt" WHERE id='upgrade-attempt'`,
    );
    assert.deepEqual(row, {
      state: "UNKNOWN",
      messageUnits: 3,
      senderDomain: "example.com",
      retained: true,
    });
    process.stdout.write(
      "Verified upgrade from 846c288, historical UNKNOWN costs, and zero schema drift.\n",
    );
  } finally {
    await client.end();
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
  rmSync(temp, { recursive: true, force: true });
  rmSync(config, { force: true });
}
