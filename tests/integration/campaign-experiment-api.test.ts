import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { redis } from "@emailsystem/core/redis";
import { GET } from "../../apps/web/app/api/campaigns/[id]/experiment/route.ts";

const users: string[] = [];

after(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("campaign experiment API is tenant scoped and exposes bounded run metadata only", async () => {
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
      name: "Activity bounded run",
      authorizationRef: "AUTH-ACTIVITY-2026",
      description: "Activity visibility proof",
      variables: {},
      maxRecipients: 25,
      maxAttempts: 40,
      maxDurationSeconds: 1800,
    },
  });
  const now = new Date();
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: 1,
      authorizationRef: profile.authorizationRef,
      state: "RUNNING",
      maxRecipients: 25,
      maxAttempts: 40,
      maxDurationSeconds: 1800,
      recipientsUsed: 7,
      attemptsUsed: 11,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    },
  });
  const campaign = await db.campaign.create({
    data: {
      userId: owner.id,
      experimentRunId: run.id,
      name: "Experiment activity campaign",
      state: "SENDING",
      message: {},
      importId: crypto.randomUUID(),
      intendedRecipientCount: 7,
      recipientCount: 7,
      startKey: crypto.randomUUID(),
    },
  });
  const ordinary = await db.campaign.create({
    data: {
      userId: owner.id,
      name: "Ordinary campaign",
      state: "QUEUED",
      message: {},
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
  const body = (await response.json()) as {
    experiment: null | {
      id: string;
      state: string;
      authorizationRef: string;
      recipientsUsed: number;
      attemptsUsed: number;
      maxRecipients: number;
      maxAttempts: number;
      profile: { name: string };
      recipients?: unknown;
      evidence?: unknown;
    };
  };
  assert.equal(body.experiment?.id, run.id);
  assert.equal(body.experiment?.state, "RUNNING");
  assert.equal(body.experiment?.authorizationRef, "AUTH-ACTIVITY-2026");
  assert.equal(body.experiment?.recipientsUsed, 7);
  assert.equal(body.experiment?.attemptsUsed, 11);
  assert.equal(body.experiment?.maxRecipients, 25);
  assert.equal(body.experiment?.maxAttempts, 40);
  assert.equal(body.experiment?.profile.name, "Activity bounded run");
  assert.equal(body.experiment?.recipients, undefined);
  assert.equal(body.experiment?.evidence, undefined);

  const ordinaryResponse = await call(ordinary.id, ownerSession.token);
  assert.equal(ordinaryResponse.status, 200);
  assert.deepEqual(await ordinaryResponse.json(), { experiment: null });

  assert.equal((await call(campaign.id, otherSession.token)).status, 404);
});
