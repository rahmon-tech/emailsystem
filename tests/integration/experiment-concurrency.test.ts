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
  if (users.length) {
    await db.campaign.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
    await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
  await redis.quit();
});

test("experiment concurrency is a run-wide transport-start cap with evidence", async () => {
  const user = await createUser(
    `experiment-concurrency-${crypto.randomUUID()}@example.com`,
    "A strong experiment concurrency password 2026",
  );
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Experiment concurrency mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 20,
    perMinute: 600,
    concurrency: 10,
  });
  assert(provider);
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });

  const profile = await createExperimentProfile(user.id, {
    name: "Run-wide concurrency verification",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description: "Proves the experiment concurrency variable is enforced before transport.",
    providerIds: [provider.id],
    senderIdentityIds: [sender.id],
    recipients: ["one@example.net", "two@example.net"],
    maxRecipients: 2,
    maxAttempts: 4,
    maxDurationSeconds: 900,
    variables: { concurrency: 1 },
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);

  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\ntwo@example.net\n"),
    "experiment-concurrency.csv",
  );
  const campaign = await createCampaign(user.id, {
    name: "Experiment concurrency campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    fromName: "Sender",
    subject: "Controlled concurrency",
    html: "<p>Controlled experiment concurrency test</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { email: "asc" },
  });
  assert.equal(deliveries.length, 2);

  let sendCalls = 0;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let releaseFirst!: () => void;
  const holdFirst = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const controlledSend: typeof send = async () => {
    sendCalls += 1;
    if (sendCalls === 1) {
      markFirstStarted();
      await holdFirst;
    }
    return {
      status: "accepted",
      providerMessageId: `controlled-${sendCalls}`,
    };
  };

  const first = processDelivery(deliveries[0]!.id, controlledSend);
  await firstStarted;
  try {
    await processDelivery(deliveries[1]!.id, controlledSend);

    assert.equal(
      sendCalls,
      1,
      "a second transport must not start while the experiment concurrency cap is occupied",
    );
    const second = await db.delivery.findUniqueOrThrow({
      where: { id: deliveries[1]!.id },
      select: { state: true, attemptCount: true },
    });
    assert.equal(second.state, "DEFERRED");
    assert.equal(second.attemptCount, 0);
    const currentCampaign = await db.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
      select: { state: true, safeError: true },
    });
    assert.equal(currentCampaign.state, "SENDING");
    assert.equal(currentCampaign.safeError, null);
  } finally {
    releaseFirst();
    await first;
  }

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
      concurrency?: {
        cap?: number | null;
        activeBeforeStart?: number | null;
        activeAfterStart?: number | null;
      };
    };
  };
  assert.deepEqual(payload.experimentControls?.concurrency, {
    cap: 1,
    activeBeforeStart: 0,
    activeAfterStart: 1,
  });
});
