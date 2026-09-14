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

test("smooth experiment pacing is a run-wide transport-start floor with evidence", async () => {
  const user = await createUser(
    `experiment-pacing-${crypto.randomUUID()}@example.com`,
    "A strong experiment pacing password 2026",
  );
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Experiment pacing mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 1000,
    perMinute: 60_000,
    concurrency: 10,
  });
  assert(provider);
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });

  const profile = await createExperimentProfile(user.id, {
    name: "Run-wide smooth pacing verification",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description:
      "Proves the approved smooth experiment interval is enforced before transport.",
    providerIds: [provider.id],
    senderIdentityIds: [sender.id],
    recipients: ["one@example.net", "two@example.net"],
    maxRecipients: 2,
    maxAttempts: 4,
    maxDurationSeconds: 900,
    variables: {
      pacingProfile: "smooth",
      pacingIntervalMs: 60_000,
    },
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);

  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\ntwo@example.net\n"),
    "experiment-pacing.csv",
  );
  const campaign = await createCampaign(user.id, {
    name: "Experiment smooth pacing campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    fromName: "Sender",
    subject: "Controlled smooth pacing",
    html: "<p>Controlled experiment smooth pacing test</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { email: "asc" },
  });
  assert.equal(deliveries.length, 2);

  let sendCalls = 0;
  const controlledSend: typeof send = async () => {
    sendCalls += 1;
    return {
      status: "accepted",
      providerMessageId: `controlled-pacing-${sendCalls}`,
    };
  };

  await processDelivery(deliveries[0]!.id, controlledSend);
  await processDelivery(deliveries[1]!.id, controlledSend);

  assert.equal(
    sendCalls,
    1,
    "a second transport must not start inside the approved smooth experiment interval",
  );

  const second = await db.delivery.findUniqueOrThrow({
    where: { id: deliveries[1]!.id },
    select: { state: true, attemptCount: true },
  });
  assert.equal(second.attemptCount, 0);
  assert.notEqual(second.state, "PROVIDER_ACCEPTED");

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
  assert.match(currentCampaign.safetyWaitReason ?? "", /experiment smooth pacing/i);

  const storedRun = await db.experimentRun.findUniqueOrThrow({
    where: { id: run.id },
    select: { attemptsUsed: true },
  });
  assert.equal(storedRun.attemptsUsed, 1);

  const evidence = await db.experimentEvidence.findFirstOrThrow({
    where: { userId: user.id, runId: run.id, kind: "transport.started" },
    orderBy: { sequence: "asc" },
    select: { payload: true },
  });
  const payload = evidence.payload as {
    experimentControls?: {
      pacing?: {
        profile?: string;
        configuredIntervalMs?: number | null;
        effectiveMinimumIntervalMs?: number | null;
      };
    };
  };
  assert.deepEqual(payload.experimentControls?.pacing, {
    profile: "smooth",
    configuredIntervalMs: 60_000,
    effectiveMinimumIntervalMs: 60_000,
  });
});
