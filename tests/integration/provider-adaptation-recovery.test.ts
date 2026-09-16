import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import { createCampaign, prepareCampaign } from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";
import { providerAdaptiveKey } from "@emailsystem/core/dispatcher";
import { refreshProviderAdaptation } from "@emailsystem/core/provider-adaptation";
import { providerPacingTelemetry } from "@emailsystem/core/provider-pacing-telemetry";

const users: string[] = [];

before(() => {
  assert.equal(
    process.env.ALLOW_MOCK_PROVIDER,
    "true",
    "Integration tests require an explicitly enabled mock provider",
  );
});

after(async () => {
  for (const user of users) {
    const keys = await redis.keys(`dispatch:${user}:*`);
    if (keys.length) await redis.del(...keys);
  }
  await db.deliveryAttempt.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("healthy durable history gradually restores adaptive provider pace without exceeding configured ceiling", async () => {
  const user = await db.user.create({
    data: {
      email: `provider-recovery-${crypto.randomUUID()}@example.com`,
      passwordHash: "isolated-test",
    },
  });
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Gradual recovery mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com", mockMode: "temporary" },
    perSecond: 100,
    perMinute: 120,
    concurrency: 4,
  });
  assert(provider);

  const list = await importRecipients(
    user.id,
    Buffer.from("recipient@example.net\n"),
    "recovery-proof.txt",
  );
  const campaign = await createCampaign(user.id, {
    name: "Gradual recovery",
    importId: list.id,
    from: "sender@example.com",
    subject: "Recovery proof",
    html: "<p>Recovery proof</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });

  await processDelivery(delivery.id);
  const pressureAttempt = await db.deliveryAttempt.findFirstOrThrow({
    where: { deliveryId: delivery.id },
  });
  assert.equal(pressureAttempt.category, "temporary");
  assert(pressureAttempt.finishedAt);

  const persistedProvider = await db.providerConnection.findUniqueOrThrow({
    where: { id: provider.id },
  });
  const key = providerAdaptiveKey(user.id, provider.id);
  await redis.del(key);
  await db.providerConnection.update({
    where: { id: provider.id },
    data: { cooldownUntil: null },
  });

  const pressureNow = new Date(pressureAttempt.finishedAt.getTime() + 1_000);
  const pressured = await refreshProviderAdaptation(pressureNow);
  assert(pressured.slowed >= 1);
  const initialSlowdown = Number(await redis.get(key));
  assert(initialSlowdown > 1);

  const healthyBase = pressureAttempt.finishedAt.getTime() + 20_000;
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomUUID();
    await db.deliveryAttempt.create({
      data: {
        id,
        userId: user.id,
        deliveryId: delivery.id,
        providerId: provider.id,
        providerRevision: persistedProvider.revision,
        idempotencyKey: id,
        state: "ACCEPTED",
        category: null,
        startedAt: new Date(healthyBase + i * 1_000 - 100),
        finishedAt: new Date(healthyBase + i * 1_000),
      },
    });
  }

  const recoveringNow = new Date(healthyBase + 6_000);
  const recovering = await refreshProviderAdaptation(recoveringNow);
  assert(recovering.slowed >= 1);
  const recoveringSlowdown = Number(await redis.get(key));
  assert(recoveringSlowdown > 1);
  assert(recoveringSlowdown < initialSlowdown);

  let currentProvider = await db.providerConnection.findUniqueOrThrow({
    where: { id: provider.id },
  });
  let telemetry = await providerPacingTelemetry(
    user.id,
    [
      {
        id: currentProvider.id,
        name: currentProvider.name,
        health: currentProvider.health,
        enabled: currentProvider.enabled,
        perMinute: currentProvider.perMinute,
        cooldownUntil: currentProvider.cooldownUntil,
      },
    ],
    recoveringNow.getTime(),
  );
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].pressure, "slowed");
  assert(telemetry[0].effectivePerMinute < telemetry[0].configuredPerMinute);
  const recoveringEffectiveRate = telemetry[0].effectivePerMinute;

  for (let i = 5; i < 20; i++) {
    const id = crypto.randomUUID();
    await db.deliveryAttempt.create({
      data: {
        id,
        userId: user.id,
        deliveryId: delivery.id,
        providerId: provider.id,
        providerRevision: persistedProvider.revision,
        idempotencyKey: id,
        state: "ACCEPTED",
        category: null,
        startedAt: new Date(healthyBase + i * 1_000 - 100),
        finishedAt: new Date(healthyBase + i * 1_000),
      },
    });
  }

  const recoveredNow = new Date(healthyBase + 25_000);
  const recovered = await refreshProviderAdaptation(recoveredNow);
  assert.equal(recovered.slowed, 0);
  assert.equal(await redis.get(key), null);

  currentProvider = await db.providerConnection.findUniqueOrThrow({
    where: { id: provider.id },
  });
  telemetry = await providerPacingTelemetry(
    user.id,
    [
      {
        id: currentProvider.id,
        name: currentProvider.name,
        health: currentProvider.health,
        enabled: currentProvider.enabled,
        perMinute: currentProvider.perMinute,
        cooldownUntil: currentProvider.cooldownUntil,
      },
    ],
    recoveredNow.getTime(),
  );
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].slowdown, 1);
  assert.equal(telemetry[0].pressure, "normal");
  assert.equal(
    telemetry[0].effectivePerMinute,
    telemetry[0].configuredPerMinute,
  );
  assert(telemetry[0].effectivePerMinute > recoveringEffectiveRate);
  assert(
    telemetry[0].effectivePerMinute <= telemetry[0].configuredPerMinute,
  );
});
