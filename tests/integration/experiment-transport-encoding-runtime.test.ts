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
import type { Dependencies, ProviderMessage } from "@emailsystem/providers";
import { connection } from "../fixtures";

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

function withoutId<T extends { id: string }>(value: T) {
  const { id: _id, ...rest } = value;
  assert(_id);
  return rest;
}

const sesVerification = {
  ses: {
    send: async (command: unknown) =>
      (command as object).constructor.name === "GetAccountCommand"
        ? {
            SendingEnabled: true,
            ProductionAccessEnabled: true,
            EnforcementStatus: "HEALTHY",
            SendQuota: {
              MaxSendRate: 20,
              Max24HourSend: 10000,
              SentLast24Hours: 0,
            },
          }
        : { VerifiedForSendingStatus: true },
  },
} as Dependencies;

test("explicit experiment transfer encoding reaches transport message and tamper-evident evidence", async () => {
  const user = await createUser(
    `experiment-encoding-${crypto.randomUUID()}@example.com`,
    "A strong experiment encoding password 2026",
  );
  users.push(user.id);

  const ses = connection("ses");
  const provider = await saveProvider(
    user.id,
    {
      ...withoutId(ses),
      name: "Experiment encoding SES",
      perSecond: 20,
      perMinute: 600,
      concurrency: 10,
    },
    undefined,
    sesVerification,
  );
  assert(provider);
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "sender@example.com" },
  });

  const profile = await createExperimentProfile(user.id, {
    name: "Explicit transfer encoding runtime",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description: "Proves approved transfer encoding reaches the existing raw MIME owner.",
    providerIds: [provider.id],
    senderIdentityIds: [sender.id],
    recipients: ["one@example.net"],
    maxRecipients: 1,
    maxAttempts: 1,
    maxDurationSeconds: 900,
    variables: {
      pacingProfile: "smooth",
      transportEncoding: "base64",
      charset: "utf-8",
      contentMode: "html",
    },
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);

  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\n"),
    "experiment-encoding.csv",
  );
  const campaign = await createCampaign(user.id, {
    name: "Experiment transfer encoding campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    fromName: "Sender",
    subject: "Controlled transfer encoding",
    html: "<p>Héllo controlled encoding</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });

  let captured: ProviderMessage | undefined;
  await processDelivery(delivery.id, async (_connection, message) => {
    captured = message;
    return { status: "accepted", providerMessageId: "controlled-encoding" };
  });

  assert(captured);
  assert.equal(captured.transportEncoding, "base64");
  assert.equal(captured.charset, "utf-8");

  const evidence = await db.experimentEvidence.findFirstOrThrow({
    where: { userId: user.id, runId: run.id, kind: "transport.started" },
    orderBy: { sequence: "asc" },
    select: { payload: true },
  });
  const payload = evidence.payload as {
    experimentControls?: {
      encoding?: {
        requestedTransportEncoding?: string;
        effectiveTransportEncoding?: string | null;
        charset?: string;
      };
    };
  };
  assert.deepEqual(payload.experimentControls?.encoding, {
    requestedTransportEncoding: "base64",
    effectiveTransportEncoding: "base64",
    charset: "utf-8",
  });
});

test("explicit transfer encoding profile rejects provider scopes that do not own raw MIME", async () => {
  const user = await createUser(
    `experiment-encoding-scope-${crypto.randomUUID()}@example.com`,
    "Another strong experiment encoding password 2026",
  );
  users.push(user.id);
  const provider = await saveProvider(user.id, {
    name: "Encoding incompatible API provider",
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

  await assert.rejects(
    () =>
      createExperimentProfile(user.id, {
        name: "Invalid explicit transfer encoding scope",
        authorizationRef: `AUTH-${crypto.randomUUID()}`,
        description: "An API-body provider cannot promise raw MIME transfer encoding.",
        providerIds: [provider.id],
        senderIdentityIds: [sender.id],
        recipients: ["one@example.net"],
        maxRecipients: 1,
        maxAttempts: 1,
        maxDurationSeconds: 900,
        variables: {
          pacingProfile: "smooth",
          transportEncoding: "quoted-printable",
          charset: "utf-8",
          contentMode: "html",
        },
      }),
    /transfer encoding|raw MIME/i,
  );
});
