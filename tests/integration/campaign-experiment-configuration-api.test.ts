import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign } from "@emailsystem/core/campaigns";
import { GET } from "../../apps/web/app/api/campaigns/[id]/experiment/route.ts";

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

test("campaign experiment Activity summary exposes normalized configuration without recipient data", async () => {
  const password = `Fixture-${crypto.randomUUID()}-Aa9!`;
  const owner = await createUser(
    `activity-config-${crypto.randomUUID()}@example.com`,
    password,
  );
  users.push(owner.id);
  const session = await login(owner.email, password, "test-ip");

  await saveProvider(owner.id, {
    name: "Activity configuration mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
  });
  const list = await importRecipients(
    owner.id,
    Buffer.from("controlled-config@example.net"),
    "activity-config.txt",
  );
  const campaign = await createCampaign(owner.id, {
    name: "Activity configuration campaign",
    importId: list.id,
    from: "sender@example.com",
    subject: "Experiment configuration",
    html: "<p>Experiment configuration</p>",
    startKey: crypto.randomUUID(),
  });

  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Activity configuration profile",
      authorizationRef: "AUTH-CONFIG-2026",
      description: "Activity configuration proof",
      variables: {
        pacingProfile: "smooth",
        pacingIntervalMs: 2500,
        concurrency: 3,
        transportEncoding: "provider-default",
        charset: "utf-8",
        contentMode: "html",
      },
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 3600,
    },
  });
  await db.experimentRecipient.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      email: "controlled-config@example.net",
    },
  });
  const now = new Date();
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: 1,
      authorizationRef: "AUTH-CONFIG-2026",
      state: "RUNNING",
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 3600,
      startsAt: now,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    },
  });
  await db.campaign.update({
    where: { id: campaign.id },
    data: { experimentRunId: run.id },
  });

  const origin = new URL(process.env.APP_URL!).origin;
  const response = await GET(
    new Request(origin + `/api/campaigns/${campaign.id}/experiment`, {
      headers: { Cookie: `${sessionCookie}=${session.token}` },
    }),
    { params: Promise.resolve({ id: campaign.id }) },
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    experiment: {
      profile: {
        variables: Record<string, unknown>;
      };
    };
  };
  assert.deepEqual(body.experiment.profile.variables, {
    pacingProfile: "smooth",
    pacingIntervalMs: 2500,
    concurrency: 3,
    transportEncoding: "provider-default",
    charset: "utf-8",
    contentMode: "html",
  });
  assert.equal(JSON.stringify(body).includes("controlled-config@example.net"), false);
});
