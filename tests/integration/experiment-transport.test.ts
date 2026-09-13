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

async function seedExperiment(
  userId: string,
  providerId: string,
  senderIdentityId: string,
  recipients: string[],
  maxRecipients: number,
  maxAttempts: number,
) {
  const profile = await createExperimentProfile(userId, {
    name: "Bound transport verification",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description: "Controlled transport binding verification.",
    providerIds: [providerId],
    senderIdentityIds: [senderIdentityId],
    recipients,
    maxRecipients,
    maxAttempts,
    maxDurationSeconds: 900,
  });
  const run = await createExperimentRun(userId, profile.id);
  await startExperimentRun(userId, run.id);
  return run;
}

function campaignInput(
  importId: string,
  senderIdentityId: string,
  experimentRunId: string,
) {
  return {
    name: "Experiment campaign",
    importId,
    senderIdentityId,
    experimentRunId,
    fromName: "Sender",
    subject: "Controlled transport",
    html: "<p>Controlled transport test</p>",
    startKey: crypto.randomUUID(),
  };
}

test("experiment campaign binds sender, recipients and provider before real transport", async () => {
  const user = await createUser(
    `experiment-transport-${crypto.randomUUID()}@example.com`,
    "A strong experiment transport password 2026",
  );
  users.push(user.id);
  const scoped = await seedProvider(user.id, "Scoped provider");
  const unscoped = await seedProvider(user.id, "Unscoped provider");
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });
  const run = await seedExperiment(
    user.id,
    scoped.id,
    sender.id,
    ["one@example.net", "two@example.net"],
    2,
    2,
  );

  const outside = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\noutside@example.net\n"),
    "outside.csv",
  );
  await assert.rejects(
    () =>
      createCampaign(
        user.id,
        campaignInput(outside.id, sender.id, run.id),
      ),
    (error: unknown) =>
      (error as { code?: string }).code === "EXPERIMENT_RECIPIENT_SCOPE",
  );

  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\ntwo@example.net\n"),
    "approved.csv",
  );
  const campaign = await createCampaign(
    user.id,
    campaignInput(list.id, sender.id, run.id),
  );
  assert.equal(campaign.experimentRunId, run.id);

  await assert.rejects(
    () =>
      createCampaign(
        user.id,
        campaignInput(list.id, sender.id, run.id),
      ),
    (error: unknown) =>
      (error as { code?: string }).code === "EXPERIMENT_RUN_BOUND",
  );

  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { email: "asc" },
  });
  assert.equal(deliveries.length, 2);
  for (const delivery of deliveries) await processDelivery(delivery.id);

  const attempts = await db.deliveryAttempt.findMany({
    where: { delivery: { campaignId: campaign.id } },
  });
  assert.equal(attempts.length, 2);
  assert(attempts.every((attempt) => attempt.experimentRunId === run.id));
  assert(attempts.every((attempt) => attempt.providerId === scoped.id));
  assert(attempts.every((attempt) => attempt.providerId !== unscoped.id));
  assert(attempts.every((attempt) => attempt.transmissionStartedAt));

  const storedRun = await db.experimentRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  assert.equal(storedRun.recipientsUsed, 2);
  assert.equal(storedRun.attemptsUsed, 2);
  assert.equal(storedRun.state, "COMPLETED");
  assert.equal(
    await db.experimentRunRecipientUse.count({ where: { runId: run.id } }),
    2,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { userId: user.id, action: "experiment.transport.started" },
    }),
    2,
  );
});

test("concurrent transport starts cannot exceed an experiment hard ceiling", async () => {
  const user = await createUser(
    `experiment-race-${crypto.randomUUID()}@example.com`,
    "Another strong experiment transport password 2026",
  );
  users.push(user.id);
  const provider = await seedProvider(user.id, "Ceiling provider");
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });
  const run = await seedExperiment(
    user.id,
    provider.id,
    sender.id,
    ["one@example.net", "two@example.net"],
    1,
    1,
  );
  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\n"),
    "one.csv",
  );
  const campaign = await createCampaign(
    user.id,
    campaignInput(list.id, sender.id, run.id),
  );
  await prepareCampaign(campaign.id);
  const first = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  const second = await db.delivery.create({
    data: {
      userId: user.id,
      campaignId: campaign.id,
      email: "two@example.net",
      state: "PENDING",
      nextAttemptAt: new Date(),
      unsubscribeToken: crypto.randomUUID(),
      unsubscribeHash: crypto.randomUUID(),
    },
  });

  await Promise.all([processDelivery(first.id), processDelivery(second.id)]);

  const transmitted = await db.deliveryAttempt.count({
    where: {
      delivery: { campaignId: campaign.id },
      transmissionStartedAt: { not: null },
    },
  });
  assert.equal(transmitted, 1);
  assert.equal(
    await db.delivery.count({
      where: { campaignId: campaign.id, state: "PROVIDER_ACCEPTED" },
    }),
    1,
  );
  const storedRun = await db.experimentRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  assert.equal(storedRun.recipientsUsed, 1);
  assert.equal(storedRun.attemptsUsed, 1);
  assert.equal(storedRun.state, "COMPLETED");
  assert.equal(
    await db.experimentRunRecipientUse.count({ where: { runId: run.id } }),
    1,
  );
});
