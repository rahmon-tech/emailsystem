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

test("adaptive provider pressure reconstructs from durable attempt history after ephemeral state loss", async () => {
  const user = await db.user.create({
    data: {
      email: `provider-restart-${crypto.randomUUID()}@example.com`,
      passwordHash: "isolated-test",
    },
  });
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Restart durability mock",
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
    "restart-proof.txt",
  );
  const campaign = await createCampaign(user.id, {
    name: "Restart durability",
    importId: list.id,
    from: "sender@example.com",
    subject: "Restart proof",
    html: "<p>Restart proof</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });

  await processDelivery(delivery.id);
  const attempt = await db.deliveryAttempt.findFirstOrThrow({
    where: { deliveryId: delivery.id },
  });
  assert.equal(attempt.category, "temporary");
  assert(attempt.finishedAt);

  const key = providerAdaptiveKey(user.id, provider.id);
  await redis.del(key);
  await db.providerConnection.update({
    where: { id: provider.id },
    data: { cooldownUntil: null },
  });

  const now = new Date(attempt.finishedAt.getTime() + 1_000);
  const refreshed = await refreshProviderAdaptation(now);
  assert(refreshed.inspected >= 1);
  assert(refreshed.slowed >= 1);
  assert(refreshed.cooldownsExtended >= 1);

  const slowdown = Number(await redis.get(key));
  assert(slowdown > 1);

  const rebuilt = await db.providerConnection.findUniqueOrThrow({
    where: { id: provider.id },
  });
  assert(rebuilt.cooldownUntil);
  assert(rebuilt.cooldownUntil.getTime() > now.getTime());

  const telemetry = await providerPacingTelemetry(
    user.id,
    [
      {
        id: rebuilt.id,
        name: rebuilt.name,
        health: rebuilt.health,
        enabled: rebuilt.enabled,
        perMinute: rebuilt.perMinute,
        cooldownUntil: rebuilt.cooldownUntil,
      },
    ],
    now.getTime(),
  );
  assert.equal(telemetry.length, 1);
  assert(telemetry[0].slowdown > 1);
  assert(telemetry[0].effectivePerMinute < telemetry[0].configuredPerMinute);
  assert.equal(telemetry[0].pressure, "cooldown");

  await redis.del(key);
  const reconstructedAgain = await refreshProviderAdaptation(now);
  assert(reconstructedAgain.slowed >= 1);
  assert(Number(await redis.get(key)) > 1);
});
