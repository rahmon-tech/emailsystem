import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import {
  createCampaign,
  prepareCampaign,
} from "@emailsystem/core/campaigns";
import { refreshProviderAdaptation } from "@emailsystem/core/provider-adaptation";
import { providerAdaptiveKey } from "@emailsystem/core/dispatcher";
import { providerPacingTelemetry } from "@emailsystem/core/provider-pacing-telemetry";

const users: string[] = [];

after(async () => {
  for (const userId of users) {
    const keys = await redis.keys(`dispatch:${userId}:*`);
    if (keys.length) await redis.del(...keys);
  }
  if (users.length)
    await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

async function seedDelivery() {
  const user = await createUser(
    `provider-adaptation-${crypto.randomUUID()}@example.com`,
    "A strong provider adaptation password 2026",
  );
  users.push(user.id);
  const provider = await saveProvider(user.id, {
    name: "Adaptive pacing provider",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 10,
    perMinute: 120,
    concurrency: 2,
  });
  assert(provider);
  assert.equal(provider.enabled, true);
  assert.equal(provider.health, "HEALTHY");

  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\n"),
    "adaptation.csv",
  );
  const campaign = await createCampaign(user.id, {
    name: "Adaptation durability campaign",
    importId: list.id,
    from: "sender@example.com",
    fromName: "Sender",
    subject: "Adaptation durability",
    html: "<p>Adaptation durability</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  return { user, provider, delivery };
}

function attemptData(input: {
  userId: string;
  deliveryId: string;
  providerId: string;
  providerRevision: number;
  category: string | null;
  state: string;
  finishedAt: Date;
}) {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    deliveryId: input.deliveryId,
    providerId: input.providerId,
    providerRevision: input.providerRevision,
    idempotencyKey: crypto.randomUUID(),
    state: input.state,
    category: input.category,
    startedAt: input.finishedAt,
    transmissionStartedAt: input.finishedAt,
    finishedAt: input.finishedAt,
    messageUnits: 1,
    senderDomain: "example.com",
  };
}

test("durable provider pressure reconstructs slowdown after Redis loss and recovers from healthy history", async () => {
  const { user, provider, delivery } = await seedDelivery();
  const observedAt = new Date();
  await db.deliveryAttempt.createMany({
    data: [3, 2, 1].map((secondsAgo) =>
      attemptData({
        userId: user.id,
        deliveryId: delivery.id,
        providerId: provider.id,
        providerRevision: provider.revision,
        category: "rate_limit",
        state: "REJECTED",
        finishedAt: new Date(observedAt.getTime() - secondsAgo * 1000),
      }),
    ),
  });

  const initial = await refreshProviderAdaptation(observedAt);
  assert(initial.inspected >= 1);
  assert(initial.slowed >= 1);
  assert(initial.cooldownsExtended >= 1);

  const key = providerAdaptiveKey(user.id, provider.id);
  const slowdown = Number(await redis.get(key));
  assert(slowdown > 1);

  let stored = await db.providerConnection.findUniqueOrThrow({
    where: { id: provider.id },
  });
  assert(stored.cooldownUntil);
  assert(stored.cooldownUntil.getTime() > observedAt.getTime());

  let telemetry = await providerPacingTelemetry(
    user.id,
    [
      {
        id: stored.id,
        name: stored.name,
        health: stored.health,
        enabled: stored.enabled,
        perMinute: stored.perMinute,
        cooldownUntil: stored.cooldownUntil,
      },
    ],
    observedAt.getTime(),
  );
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].slowdown, slowdown);
  assert(telemetry[0].effectivePerMinute < stored.perMinute);
  assert.equal(telemetry[0].pressure, "cooldown");
  assert(telemetry[0].nextAllowedAt);

  // Simulate loss of ephemeral adaptive state during a worker/Redis restart.
  await redis.del(key);
  assert.equal(await redis.get(key), null);

  const restartAt = new Date(observedAt.getTime() + 5000);
  const reconstructed = await refreshProviderAdaptation(restartAt);
  assert(reconstructed.inspected >= 1);
  const restoredSlowdown = Number(await redis.get(key));
  assert.equal(restoredSlowdown, slowdown);

  // A later healthy sample displaces the transient streak and returns effective
  // pacing to the configured ceiling once the durable cooldown has elapsed.
  const recoveryAt = new Date(observedAt.getTime() + 130_000);
  await db.deliveryAttempt.createMany({
    data: Array.from({ length: 20 }, (_, index) =>
      attemptData({
        userId: user.id,
        deliveryId: delivery.id,
        providerId: provider.id,
        providerRevision: provider.revision,
        category: null,
        state: "ACCEPTED",
        finishedAt: new Date(recoveryAt.getTime() - (20 - index) * 1000),
      }),
    ),
  });

  const recovered = await refreshProviderAdaptation(recoveryAt);
  assert(recovered.inspected >= 1);
  assert.equal(await redis.get(key), null);

  stored = await db.providerConnection.findUniqueOrThrow({
    where: { id: provider.id },
  });
  assert(stored.cooldownUntil);
  assert(stored.cooldownUntil.getTime() < recoveryAt.getTime());

  telemetry = await providerPacingTelemetry(
    user.id,
    [
      {
        id: stored.id,
        name: stored.name,
        health: stored.health,
        enabled: stored.enabled,
        perMinute: stored.perMinute,
        cooldownUntil: stored.cooldownUntil,
      },
    ],
    recoveryAt.getTime(),
  );
  assert.equal(telemetry[0].slowdown, 1);
  assert.equal(telemetry[0].effectivePerMinute, stored.perMinute);
  assert.equal(telemetry[0].pressure, "normal");
  assert.equal(telemetry[0].nextAllowedAt, null);
});
