import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { appendExperimentEvidence } from "@emailsystem/core/experiment-evidence";
import { GET } from "../../apps/web/app/api/campaigns/[id]/experiment/evidence/route.ts";

const users: string[] = [];

after(async () => {
  if (users.length) {
    await db.campaign.deleteMany({ where: { userId: { in: users } } });
    await db.contactImport.deleteMany({ where: { userId: { in: users } } });
    await db.experimentEvidence.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
    await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
  await redis.quit();
});

test("experiment evidence summary is tenant-safe and excludes evidence payload data", async () => {
  const password = `Fixture-${crypto.randomUUID()}-Aa9!`;
  const owner = await createUser(
    `evidence-summary-owner-${crypto.randomUUID()}@example.com`,
    password,
  );
  const other = await createUser(
    `evidence-summary-other-${crypto.randomUUID()}@example.com`,
    password,
  );
  users.push(owner.id, other.id);
  const ownerSession = await login(owner.email, password, "evidence-summary-owner");
  const otherSession = await login(other.email, password, "evidence-summary-other");

  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Evidence review profile",
      authorizationRef: "AUTH-EVIDENCE-REVIEW",
      variables: {
        pacingProfile: "smooth",
        transportEncoding: "provider-default",
        charset: "utf-8",
        contentMode: "html",
      },
      maxRecipients: 2,
      maxAttempts: 4,
      maxDurationSeconds: 900,
    },
  });
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: 1,
      authorizationRef: "AUTH-EVIDENCE-REVIEW",
      state: "RUNNING",
      maxRecipients: 2,
      maxAttempts: 4,
      maxDurationSeconds: 900,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
    },
  });
  const contactImport = await db.contactImport.create({
    data: {
      userId: owner.id,
      filename: "evidence-review.txt",
      state: "READY",
      stats: { valid: 0, invalid: 0, duplicate: 0 },
    },
  });
  const campaign = await db.campaign.create({
    data: {
      userId: owner.id,
      experimentRunId: run.id,
      name: "Evidence review campaign",
      message: {
        from: "sender@example.com",
        subject: "Evidence review",
        html: "<p>Evidence review</p>",
        text: "Evidence review",
      },
      importId: contactImport.id,
      startKey: crypto.randomUUID(),
    },
  });
  await db.$transaction(async (tx) => {
    await appendExperimentEvidence(tx, {
      userId: owner.id,
      runId: run.id,
      kind: "run.started",
      payload: { secretObservation: "never-return-this" },
      createdAt: new Date("2026-09-17T12:00:00.000Z"),
    });
    await appendExperimentEvidence(tx, {
      userId: owner.id,
      runId: run.id,
      kind: "transport.outcome",
      attemptId: "attempt-hidden-1",
      providerId: "provider-hidden-1",
      campaignId: campaign.id,
      payload: {
        recipientHash: "recipient-hash-must-stay-server-side",
        providerMessageId: "message-id-must-stay-server-side",
      },
      createdAt: new Date("2026-09-17T12:00:01.000Z"),
    });
  });

  const origin = new URL(process.env.APP_URL!).origin;
  const call = (token: string) =>
    GET(
      new Request(origin + `/api/campaigns/${campaign.id}/experiment/evidence`, {
        headers: { Cookie: `${sessionCookie}=${token}` },
      }),
      { params: Promise.resolve({ id: campaign.id }) },
    );

  const response = await call(ownerSession.token);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    runId: string;
    evidence: {
      retention: { status: string; purgedAt: string | null };
      integrity: {
        available: boolean;
        valid: boolean;
        count: number;
        verifiedThrough: number;
        headHash: string | null;
      };
      recent: Array<{ sequence: number; kind: string; createdAt: string }>;
    };
  };
  assert.equal(body.runId, run.id);
  assert.deepEqual(body.evidence.retention, { status: "retained", purgedAt: null });
  assert.equal(body.evidence.integrity.available, true);
  assert.equal(body.evidence.integrity.valid, true);
  assert.equal(body.evidence.integrity.count, 2);
  assert.equal(body.evidence.integrity.verifiedThrough, 2);
  assert(body.evidence.integrity.headHash);
  assert.deepEqual(
    body.evidence.recent.map(({ sequence, kind }) => ({ sequence, kind })),
    [
      { sequence: 2, kind: "transport.outcome" },
      { sequence: 1, kind: "run.started" },
    ],
  );

  const serialized = JSON.stringify(body);
  for (const hidden of [
    "payload",
    "never-return-this",
    "recipient-hash-must-stay-server-side",
    "message-id-must-stay-server-side",
    "attempt-hidden-1",
    "provider-hidden-1",
    "sender@example.com",
  ]) {
    assert.equal(serialized.includes(hidden), false, `summary exposed ${hidden}`);
  }

  assert.equal((await call(otherSession.token)).status, 404);
});
