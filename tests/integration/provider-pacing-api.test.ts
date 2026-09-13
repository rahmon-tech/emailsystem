import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { providerAdaptiveKey } from "@emailsystem/core/dispatcher";
import { GET } from "../../apps/web/app/api/provider-pacing/route.ts";

const users: string[] = [];

after(async () => {
  for (const user of users) {
    const keys = await redis.keys(`dispatch:${user}:*`);
    if (keys.length) await redis.del(...keys);
  }
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("provider pacing telemetry is tenant scoped and exposes only safe derived pressure", async () => {
  const owner = await createUser(
    `provider-pace-${crypto.randomUUID()}@example.com`,
    "A strong provider pacing password 2026",
  );
  const other = await createUser(
    `provider-pace-${crypto.randomUUID()}@example.com`,
    "Another provider pacing password 2026",
  );
  users.push(owner.id, other.id);
  const ownerSession = await login(
    owner.email,
    "A strong provider pacing password 2026",
    "test-ip",
  );

  const ownerProvider = await saveProvider(owner.id, {
    name: "Owner pacing mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "owner@example.com" },
    perSecond: 10,
    perMinute: 120,
    concurrency: 2,
  });
  await saveProvider(other.id, {
    name: "Foreign pacing mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "other@example.net" },
    perSecond: 10,
    perMinute: 600,
    concurrency: 2,
  });
  assert(ownerProvider);
  await redis.set(providerAdaptiveKey(owner.id, ownerProvider.id), "2", "EX", 60);
  await redis.set(
    `dispatch:${owner.id}:${ownerProvider.id}:next`,
    String(Date.now() + 30_000),
    "PX",
    60_000,
  );

  const origin = new URL(process.env.APP_URL!).origin;
  const response = await GET(
    new Request(origin + "/api/provider-pacing", {
      headers: { Cookie: `${sessionCookie}=${ownerSession.token}` },
    }),
  );
  assert.equal(response.status, 200);
  const rows = (await response.json()) as {
    id: string;
    name: string;
    configuredPerMinute: number;
    effectivePerMinute: number;
    slowdown: number;
    nextAllowedAt: string | null;
    pressure: string;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, ownerProvider.id);
  assert.equal(rows[0].name, "Owner pacing mock");
  assert.equal(rows[0].configuredPerMinute, 120);
  assert.equal(rows[0].effectivePerMinute, 60);
  assert.equal(rows[0].slowdown, 2);
  assert.equal(rows[0].pressure, "slowed");
  assert(rows[0].nextAllowedAt);
  assert(!JSON.stringify(rows).includes("Foreign pacing mock"));
  assert(!JSON.stringify(rows).includes("credentials"));
});
