import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import {
  createCampaign,
  preflight,
  prepareCampaign,
} from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";
import {
  createExperimentProfile,
  createExperimentRun,
  startExperimentRun,
} from "@emailsystem/core/experiments";
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

async function capableFixture() {
  const user = await createUser(
    `experiment-content-${crypto.randomUUID()}@example.com`,
    "A strong controlled content mode password 2026",
  );
  users.push(user.id);
  const fixture = connection("resend");
  const provider = await saveProvider(
    user.id,
    {
      ...withoutId(fixture),
      name: "Experiment CID provider",
      perSecond: 10,
      perMinute: 60,
      concurrency: 5,
      settings: {
        ...fixture.settings,
        fromEmail: "cid-sender@cid.example.com",
        domain: "cid.example.com",
      },
    },
    undefined,
    {
      fetch: async () =>
        Response.json({
          data: [{ name: "cid.example.com", status: "verified" }],
        }),
    },
  );
  assert(provider);
  const sender = await db.senderIdentity.findFirstOrThrow({
    where: { userId: user.id, email: "cid-sender@cid.example.com" },
  });
  const list = await importRecipients(
    user.id,
    Buffer.from("email\none@example.net\n"),
    "experiment-content.csv",
  );
  const profile = await createExperimentProfile(user.id, {
    name: "CID inline content mode",
    authorizationRef: `AUTH-${crypto.randomUUID()}`,
    description: "Proves CID-inline mode reuses the verified campaign and provider owners.",
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
      contentMode: "cid-inline",
    },
  });
  const run = await createExperimentRun(user.id, profile.id);
  await startExperimentRun(user.id, run.id);
  return { user, provider, sender, list, run };
}

test("cid-inline experiment profiles reject provider scopes without inline CID support", async () => {
  const user = await createUser(
    `experiment-content-scope-${crypto.randomUUID()}@example.com`,
    "Another strong controlled content mode password 2026",
  );
  users.push(user.id);
  const provider = await saveProvider(user.id, {
    name: "CID incompatible API provider",
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

  await assert.rejects(
    () =>
      createExperimentProfile(user.id, {
        name: "Invalid CID inline scope",
        authorizationRef: `AUTH-${crypto.randomUUID()}`,
        description: "A provider without inline CID support cannot satisfy CID-inline mode.",
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
          contentMode: "cid-inline",
        },
      }),
    /CID|inline/i,
  );
});

test("cid-inline experiment preflight requires a real referenced inline attachment before campaign mutation", async () => {
  const { user, sender, list, run } = await capableFixture();

  await assert.rejects(
    () =>
      preflight(user.id, {
        name: "Missing CID structure",
        importId: list.id,
        senderIdentityId: sender.id,
        experimentRunId: run.id,
        subject: "Missing CID structure",
        html: "<p>This message has no inline CID asset.</p>",
        text: "This message has no inline CID asset.",
        attachments: [],
        tracking: { enabled: false },
      }),
    /CID-inline|inline CID/i,
  );

  assert.equal(
    await db.campaign.count({ where: { userId: user.id, experimentRunId: run.id } }),
    0,
  );
});

test("cid-inline experiment reaches transport through existing CID structure and records truthful effective evidence", async () => {
  const { user, sender, list, run } = await capableFixture();
  const image = Buffer.from("controlled-image-bytes").toString("base64");
  const campaign = await createCampaign(user.id, {
    name: "Controlled CID inline campaign",
    importId: list.id,
    senderIdentityId: sender.id,
    experimentRunId: run.id,
    subject: "Controlled CID inline",
    html: '<img src="cid:hero-image" alt="Hero" />',
    text: "Hero",
    attachments: [
      {
        filename: "hero.png",
        content: image,
        contentType: "image/png",
        disposition: "inline",
        contentId: "hero-image",
      },
    ],
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
    assert.match(message.html, /cid:hero-image/i);
    assert.deepEqual(
      message.attachments.map((attachment) => ({
        disposition: attachment.disposition,
        contentId: attachment.contentId,
      })),
      [{ disposition: "inline", contentId: "hero-image" }],
    );
    return { status: "accepted", providerMessageId: "controlled-cid-inline" };
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
    requestedMode: "cid-inline",
    effectiveMode: "cid-inline",
  });
});
