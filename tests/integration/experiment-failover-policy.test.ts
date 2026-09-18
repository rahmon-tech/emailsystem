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
import { processDelivery } from "@emailsystem/core/engine";
import {
  createExperimentProfile,
  createExperimentRun,
  startExperimentRun,
} from "@emailsystem/core/experiments";

const users: string[] = [];

after(async () => {
  if (users.length) {
    await db.campaign.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
    await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
  await redis.quit();
});

async function seedProvider(userId: string, name: string) {
  const provider = await saveProvider(userId, {
    name,
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 20,
    perMinute: 600,
    concurrency: 10,
  });
  assert(provider);
  return provider;
}

async function seedScenario(recipients: string[], maxAttempts: number) {
  const user = await createUser(
    `experiment-failover-${crypto.randomUUID()}@example.com`,
    "A strong experiment failover password 2026",
  );
  users.push(user.id);

  const firstProvider = await seedProvider(user.id, "Failover provider A");
  const secondProvider = await seedProvider(user.id, "Failover provider B");
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });

  const profile = await createExperimentProfile(user.id, {
    name: "Failover versus policy boundary",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description:
      "Controlled proof that temporary pressure may fail over while policy enforcement stops transport.",
    providerIds: [firstProvider.id, secondProvider.id],
    senderIdentityIds: [sender.id],
    recipients,
    maxRecipients: recipients.length,
    maxAttempts,
    maxDurationSeconds: 900,
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);

  const list = await importRecipients(
    user.id,
    Buffer.from(`email\n${recipients.join("\n")}\n`),
    "controlled-failover.csv",
  );
  const campaign = await createCampaign(user.id, {
    name: "Failover boundary campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    fromName: "Sender",
    subject: "Controlled failover boundary",
    html: "<p>Controlled failover boundary test</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { email: "asc" },
  });

  return {
    user,
    run,
    campaign,
    deliveries,
    providerIds: [firstProvider.id, secondProvider.id],
  };
}

test("temporary provider pressure cools down the provider and retries through another approved provider", async () => {
  const scenario = await seedScenario(["one@example.net"], 2);
  const delivery = scenario.deliveries[0];
  assert(delivery);

  let firstProviderId: string | null = null;
  await processDelivery(delivery.id, async (connection) => {
    firstProviderId = connection.id;
    return {
      status: "rejected",
      error: {
        category: "temporary",
        message: "Provider temporarily unavailable.",
        retryAfterMs: 120_000,
      },
    };
  });
  assert(firstProviderId);

  const deferred = await db.delivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  assert.equal(deferred.state, "DEFERRED");
  const cooledProvider = await db.providerConnection.findUniqueOrThrow({
    where: { id: firstProviderId },
  });
  assert(cooledProvider.cooldownUntil);
  assert(cooledProvider.cooldownUntil.getTime() > Date.now());
  const afterTemporary = await db.campaign.findUniqueOrThrow({
    where: { id: scenario.campaign.id },
  });
  assert.notEqual(afterTemporary.state, "PAUSED");

  await db.delivery.update({
    where: { id: delivery.id },
    data: { nextAttemptAt: new Date(0) },
  });

  let secondProviderId: string | null = null;
  await processDelivery(delivery.id, async (connection) => {
    secondProviderId = connection.id;
    return { status: "accepted", providerMessageId: "failover-accepted" };
  });
  assert(secondProviderId);
  assert.notEqual(secondProviderId, firstProviderId);
  assert(scenario.providerIds.includes(secondProviderId));

  const attempts = await db.deliveryAttempt.findMany({
    where: { deliveryId: delivery.id },
  });
  assert.equal(attempts.length, 2);
  assert.equal(new Set(attempts.map((attempt) => attempt.providerId)).size, 2);
  assert(attempts.every((attempt) => attempt.transmissionStartedAt));
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).state,
    "PROVIDER_ACCEPTED",
  );

  const run = await db.experimentRun.findUniqueOrThrow({
    where: { id: scenario.run.id },
  });
  assert.equal(run.attemptsUsed, 2);
  assert.equal(run.recipientsUsed, 1);
  assert.equal(run.state, "COMPLETED");
});

test("provider policy enforcement stops transport instead of failing over to another healthy provider", async () => {
  const scenario = await seedScenario(
    ["one@example.net", "two@example.net"],
    2,
  );
  const firstDelivery = scenario.deliveries[0];
  const secondDelivery = scenario.deliveries[1];
  assert(firstDelivery);
  assert(secondDelivery);

  let blockedProviderId: string | null = null;
  await processDelivery(firstDelivery.id, async (connection) => {
    blockedProviderId = connection.id;
    return {
      status: "rejected",
      error: {
        category: "policy",
        message: "Provider enforcement requires account review.",
      },
    };
  });
  assert(blockedProviderId);

  const blockedProvider = await db.providerConnection.findUniqueOrThrow({
    where: { id: blockedProviderId },
  });
  assert.equal(blockedProvider.health, "POLICY_BLOCKED");
  assert.equal(blockedProvider.enabled, false);

  const alternateProviderId = scenario.providerIds.find(
    (providerId) => providerId !== blockedProviderId,
  );
  assert(alternateProviderId);
  const alternateProvider = await db.providerConnection.findUniqueOrThrow({
    where: { id: alternateProviderId },
  });
  assert.equal(alternateProvider.health, "HEALTHY");
  assert.equal(alternateProvider.enabled, true);

  const paused = await db.campaign.findUniqueOrThrow({
    where: { id: scenario.campaign.id },
  });
  assert.equal(paused.state, "PAUSED");
  assert.match(paused.safeError ?? "", /approved.*controlled experiment.*blocked/i);

  // Even if an operator tries to resume before reviewing the block, the
  // campaign must fail closed rather than routing around enforcement.
  await db.campaign.update({
    where: { id: scenario.campaign.id },
    data: { state: "QUEUED", safeError: null },
  });

  let unexpectedSendCalled = false;
  await processDelivery(secondDelivery.id, async () => {
    unexpectedSendCalled = true;
    return { status: "accepted", providerMessageId: "must-not-send" };
  });
  assert.equal(unexpectedSendCalled, false);

  const attempts = await db.deliveryAttempt.findMany({
    where: { delivery: { campaignId: scenario.campaign.id } },
  });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.providerId, blockedProviderId);
  assert.equal(
    await db.deliveryAttempt.count({
      where: { deliveryId: secondDelivery.id },
    }),
    0,
  );

  const repaused = await db.campaign.findUniqueOrThrow({
    where: { id: scenario.campaign.id },
  });
  assert.equal(repaused.state, "PAUSED");
  assert.match(repaused.safeError ?? "", /Provider enforcement reported/);

  const run = await db.experimentRun.findUniqueOrThrow({
    where: { id: scenario.run.id },
  });
  assert.equal(run.attemptsUsed, 1);
  assert.equal(run.recipientsUsed, 1);
  assert.equal(run.state, "RUNNING");
});
