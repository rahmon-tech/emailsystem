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

test("html experiment mode reaches the existing normalized HTML transport and records truthful effective evidence", async () => {
  const user = await createUser(
    `experiment-html-${crypto.randomUUID()}@example.com`,
    "A strong controlled html content mode password 2026",
  );
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Controlled HTML provider",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 10,
    perMinute: 60,
    concurrency: 5,
  });
  assert(provider);

  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });
  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\n"),
    "experiment-html.csv",
  );
  const profile = await createExperimentProfile(user.id, {
    name: "HTML content mode",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description: "Proves HTML mode reuses the existing normalized campaign snapshot and delivery path.",
    providerIds: [provider.id],
    senderIdentityIds: [sender.id],
    recipients: ["one@example.net"],
    maxRecipients: 1,
    maxAttempts: 1,
    maxDurationSeconds: 900,
    variables: {
      pacingProfile: "smooth",
      transportEncoding: "provider-default",
      charset: "utf-8",
      contentMode: "html",
    },
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);

  const campaign = await createCampaign(user.id, {
    name: "Controlled HTML campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    subject: "Controlled HTML",
    html: "<h1>Hello</h1><p>Existing normalized HTML path.</p>",
    text: "Hello. Existing normalized HTML path.",
    attachments: [],
    tracking: { enabled: false },
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);

  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id, userId: user.id },
  });

  let sends = 0;
  await processDelivery(delivery.id, async (_connection, message) => {
    sends++;
    assert.match(message.html, /<h1>Hello<\/h1>/i);
    assert.match(message.text, /Existing normalized HTML path/i);
    return { status: "accepted", providerMessageId: "controlled-html" };
  });
  assert.equal(sends, 1);

  const evidence = await db.experimentEvidence.findFirstOrThrow({
    where: { userId: user.id, runId: run.id, kind: "transport.started" },
    orderBy: { sequence: "asc" },
    select: { payload: true },
  });
  const payload = evidence.payload as {
    experimentControls?: {
      content?: { requestedMode?: string; effectiveMode?: string | null };
    };
  };
  assert.deepEqual(payload.experimentControls?.content, {
    requestedMode: "html",
    effectiveMode: "html",
  });
});
