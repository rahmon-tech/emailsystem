import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { GET } from "../../apps/web/app/api/campaigns/[id]/experiment/route.ts";

const users: string[] = [];

after(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("campaign experiment Activity summary is tenant scoped and bounded", async () => {
  const owner = await createUser(
    `activity-experiment-${crypto.randomUUID()}@example.com`,
    "Activity experiment password 2026",
  );
  const other = await createUser(
    `activity-experiment-${crypto.randomUUID()}@example.com`,
    "Other activity experiment password 2026",
  );
  users.push(owner.id, other.id);

  const ownerSession = await login(
    owner.email,
    "Activity experiment password 2026",
    "test-ip",
  );
  const otherSession = await login(
    other.email,
    "Other activity experiment password 2026",
    "test-ip",
  );

  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Activity UX profile",
      authorizationRef: "AUTH-ACTIVITY-UX-2026",
      maxRecipients: 25,
      maxAttempts: 40,
      maxDurationSeconds: 3600,
    },
  });
  const startsAt = new Date(Date.now() - 60_000);
  const expiresAt = new Date(Date.now() + 3_600_000);
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: profile.version,
      authorizationRef: profile.authorizationRef,
      state: "RUNNING",
      maxRecipients: 25,
      maxAttempts: 40,
      maxDurationSeconds: 3600,
      recipientsUsed: 4,
      attemptsUsed: 6,
      startsAt,
      expiresAt,
      startedAt: startsAt,
    },
  });
  const campaign = await db.campaign.create({
    data: {
      userId: owner.id,
      experimentRunId: run.id,
      name: "Experiment Activity campaign",
      state: "SENDING",
      message: { from: "sender@example.com" },
      importId: crypto.randomUUID(),
      intendedRecipientCount: 10,
      recipientCount: 10,
      startKey: crypto.randomUUID(),
    },
  });
  const ordinaryCampaign = await db.campaign.create({
    data: {
      userId: owner.id,
      name: "Ordinary Activity campaign",
      state: "QUEUED",
      message: { from: "sender@example.com" },
      importId: crypto.randomUUID(),
      intendedRecipientCount: 1,
      recipientCount: 1,
      startKey: crypto.randomUUID(),
    },
  });

  const origin = new URL(process.env.APP_URL!).origin;
  const call = (campaignId: string, token: string) =>
    GET(
      new Request(origin + `/api/campaigns/${campaignId}/experiment`, {
        headers: { Cookie: `${sessionCookie}=${token}` },
      }),
      { params: Promise.resolve({ id: campaignId }) },
    );

  const response = await call(campaign.id, ownerSession.token);
  assert.equal(response.status, 200);
  const summary = (await response.json()) as {
    id: string;
    state: string;
    authorizationRef: string;
    recipientsUsed: number;
    maxRecipients: number;
    attemptsUsed: number;
    maxAttempts: number;
    profile: { name: string };
  };
  assert.equal(summary.id, run.id);
  assert.equal(summary.state, "RUNNING");
  assert.equal(summary.authorizationRef, "AUTH-ACTIVITY-UX-2026");
  assert.equal(summary.recipientsUsed, 4);
  assert.equal(summary.maxRecipients, 25);
  assert.equal(summary.attemptsUsed, 6);
  assert.equal(summary.maxAttempts, 40);
  assert.equal(summary.profile.name, "Activity UX profile");
  assert.equal(Object.hasOwn(summary, "recipients"), false);

  const ordinary = await call(ordinaryCampaign.id, ownerSession.token);
  assert.equal(ordinary.status, 200);
  assert.equal(await ordinary.json(), null);

  assert.equal((await call(campaign.id, otherSession.token)).status, 404);
});
