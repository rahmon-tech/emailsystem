import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import { createCampaign, prepareCampaign } from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";
import {
  createExperimentProfile,
  createExperimentRun,
  startExperimentRun,
} from "@emailsystem/core/experiments";
import { send } from "@emailsystem/providers";

const users: string[] = [];

after(async () => {
  for (const userId of users) {
    const keys = await redis.keys(`dispatch:${userId}:*`);
    if (keys.length) await redis.del(...keys);
  }
  if (users.length) {
    await db.campaign.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
    await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
  await redis.quit();
});

test("bounded-burst experiment pacing admits only the configured run-wide burst per window", async () => {
  const user = await createUser(
    `experiment-burst-${crypto.randomUUID()}@example.com`,
    "A strong bounded burst experiment password 2026",
  );
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Experiment bounded burst mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 100,
    perMinute: 6000,
    concurrency: 10,
  });
  assert(provider);
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });

  const profile = await createExperimentProfile(user.id, {
    name: "Run-wide bounded burst verification",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description:
      "Proves an explicit experiment burst size is enforced as an additional run-wide ceiling.",
    providerIds: [provider.id],
    senderIdentityIds: [sender.id],
    recipients: [
      "one@example.net",
      "two@example.net",
      "three@example.net",
    ],
    maxRecipients: 3,
    maxAttempts: 5,
    maxDurationSeconds: 900,
    variables: {
      pacingProfile: "bounded-burst",
      pacingIntervalMs: 60_000,
      pacingBurstSize: 2,
    },
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);

  const list = await importRecipients(
    user.id,
    Buffer.from(
      "email\none@example.net\ntwo@example.net\nthree@example.net\n",
    ),
    "experiment-bounded-burst.csv",
  );
  const campaign = await createCampaign(user.id, {
    name: "Experiment bounded burst campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    fromName: "Sender",
    subject: "Controlled bounded burst",
    html: "<p>Controlled experiment bounded burst test</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { email: "asc" },
  });
  assert.equal(deliveries.length, 3);

  let sendCalls = 0;
  const controlledSend: typeof send = async () => {
    sendCalls += 1;
    return {
      status: "accepted",
      providerMessageId: `controlled-burst-${sendCalls}`,
    };
  };

  await processDelivery(deliveries[0]!.id, controlledSend);
  await processDelivery(deliveries[1]!.id, controlledSend);
  await processDelivery(deliveries[2]!.id, controlledSend);

  assert.equal(
    sendCalls,
    2,
    "a third transport must not start after the configured run-wide burst is occupied",
  );

  const third = await db.delivery.findUniqueOrThrow({
    where: { id: deliveries[2]!.id },
    select: { state: true, attemptCount: true },
  });
  assert.equal(third.attemptCount, 0);
  assert.notEqual(third.state, "PROVIDER_ACCEPTED");

  const currentCampaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaign.id },
    select: {
      state: true,
      safeError: true,
      safetyWaitUntil: true,
      safetyWaitReason: true,
    },
  });
  assert.equal(currentCampaign.state, "SENDING");
  assert.equal(currentCampaign.safeError, null);
  assert(currentCampaign.safetyWaitUntil);
  assert(currentCampaign.safetyWaitUntil.getTime() > Date.now());
  assert.match(currentCampaign.safetyWaitReason ?? "", /bounded burst/i);

  const storedRun = await db.experimentRun.findUniqueOrThrow({
    where: { id: run.id },
    select: { attemptsUsed: true },
  });
  assert.equal(storedRun.attemptsUsed, 2);

  const evidence = await db.experimentEvidence.findMany({
    where: { userId: user.id, runId: run.id, kind: "transport.started" },
    orderBy: { sequence: "asc" },
    select: { payload: true },
  });
  assert.equal(evidence.length, 2);

  const pacing = evidence.map((item) => {
    const payload = item.payload as {
      experimentControls?: {
        pacing?: {
          profile?: string;
          windowMs?: number;
          burstSize?: number;
          occupancyBeforeStart?: number;
          occupancyAfterStart?: number;
        };
      };
    };
    return payload.experimentControls?.pacing;
  });
  assert.deepEqual(pacing, [
    {
      profile: "bounded-burst",
      windowMs: 60_000,
      burstSize: 2,
      occupancyBeforeStart: 0,
      occupancyAfterStart: 1,
    },
    {
      profile: "bounded-burst",
      windowMs: 60_000,
      burstSize: 2,
      occupancyBeforeStart: 1,
      occupancyAfterStart: 2,
    },
  ]);
});
