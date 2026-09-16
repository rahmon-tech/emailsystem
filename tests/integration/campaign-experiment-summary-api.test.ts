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
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("campaign experiment summary is tenant scoped and excludes controlled recipients", async () => {
  const owner = await createUser(
    `activity-experiment-${crypto.randomUUID()}@example.com`,
    "A strong activity experiment password 2026",
  );
  const other = await createUser(
    `activity-experiment-${crypto.randomUUID()}@example.com`,
    "Another activity experiment password 2026",
  );
  users.push(owner.id, other.id);

  const ownerSession = await login(
    owner.email,
    "A strong activity experiment password 2026",
    "test-ip",
  );
  const otherSession = await login(
    other.email,
    "Another activity experiment password 2026",
    "test-ip",
  );

  await saveProvider(owner.id, {
    name: "Activity experiment mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
  });
  const list = await importRecipients(
    owner.id,
    Buffer.from("controlled@example.net"),
    "activity-experiment.txt",
  );
  const campaign = await createCampaign(owner.id, {
    name: "Activity experiment campaign",
    importId: list.id,
    from: "sender@example.com",
    subject: "Experiment activity",
    html: "<p>Experiment activity</p>",
    startKey: crypto.randomUUID(),
  });

  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Activity resilience profile",
      authorizationRef: "AUTH-ACTIVITY-2026",
      description: "Activity presentation proof",
      variables: {
        pacingProfile: "smooth",
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
      email: "controlled@example.net",
    },
  });
  const now = new Date();
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: 1,
      authorizationRef: "AUTH-ACTIVITY-2026",
      state: "RUNNING",
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 3600,
      recipientsUsed: 2,
      attemptsUsed: 3,
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
  const call = (token: string) =>
    GET(
      new Request(origin + `/api/campaigns/${campaign.id}/experiment`, {
        headers: { Cookie: `${sessionCookie}=${token}` },
      }),
      { params: Promise.resolve({ id: campaign.id }) },
    );

  const response = await call(ownerSession.token);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    experiment: {
      id: string;
      state: string;
      authorizationRef: string;
      recipientsUsed: number;
      maxRecipients: number;
      attemptsUsed: number;
      maxAttempts: number;
      profile: { name: string };
    };
  };
  assert.equal(body.experiment.id, run.id);
  assert.equal(body.experiment.state, "RUNNING");
  assert.equal(body.experiment.authorizationRef, "AUTH-ACTIVITY-2026");
  assert.equal(body.experiment.recipientsUsed, 2);
  assert.equal(body.experiment.maxRecipients, 10);
  assert.equal(body.experiment.attemptsUsed, 3);
  assert.equal(body.experiment.maxAttempts, 20);
  assert.equal(body.experiment.profile.name, "Activity resilience profile");
  assert.equal(JSON.stringify(body).includes("controlled@example.net"), false);

  assert.equal((await call(otherSession.token)).status, 404);
});
