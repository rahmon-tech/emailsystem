import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { GET } from "../../apps/web/app/api/campaigns/[id]/experiment/route.ts";

const users: string[] = [];

after(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("campaign experiment summary is tenant scoped and absent for ordinary campaigns", async () => {
  const owner = await createUser(
    `experiment-activity-${crypto.randomUUID()}@example.com`,
    "Experiment activity password 2026",
  );
  const other = await createUser(
    `experiment-activity-${crypto.randomUUID()}@example.com`,
    "Other experiment activity password 2026",
  );
  users.push(owner.id, other.id);

  const ownerSession = await login(
    owner.email,
    "Experiment activity password 2026",
    "test-ip",
  );
  const otherSession = await login(
    other.email,
    "Other experiment activity password 2026",
    "test-ip",
  );

  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Activity experiment",
      authorizationRef: "AUTH-ACTIVITY-2026",
      maxRecipients: 25,
      maxAttempts: 40,
      maxDurationSeconds: 3600,
    },
  });
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
      recipientsUsed: 7,
      attemptsUsed: 9,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const campaign = await db.campaign.create({
    data: {
      userId: owner.id,
      experimentRunId: run.id,
      name: "Experiment-bound campaign",
      message: {},
      importId: crypto.randomUUID(),
      startKey: crypto.randomUUID(),
    },
  });
  const ordinary = await db.campaign.create({
    data: {
      userId: owner.id,
      name: "Ordinary campaign",
      message: {},
      importId: crypto.randomUUID(),
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
    attemptsUsed: number;
    maxRecipients: number;
    maxAttempts: number;
    profile: { name: string };
  };
  assert.equal(summary.id, run.id);
  assert.equal(summary.state, "RUNNING");
  assert.equal(summary.authorizationRef, "AUTH-ACTIVITY-2026");
  assert.equal(summary.recipientsUsed, 7);
  assert.equal(summary.attemptsUsed, 9);
  assert.equal(summary.maxRecipients, 25);
  assert.equal(summary.maxAttempts, 40);
  assert.equal(summary.profile.name, "Activity experiment");

  const ordinaryResponse = await call(ordinary.id, ownerSession.token);
  assert.equal(ordinaryResponse.status, 200);
  assert.equal(await ordinaryResponse.json(), null);

  assert.equal((await call(campaign.id, otherSession.token)).status, 404);
});
