import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import {
  appendExperimentEvidence,
  experimentRecipientHash,
} from "@emailsystem/core/experiment-evidence";
import { GET as getEvidence } from "../../apps/web/app/api/experiment-runs/[id]/evidence/route.ts";

const users: string[] = [];

after(async () => {
  await db.experimentEvidence.deleteMany({ where: { userId: { in: users } } });
  await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
  await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("experiment evidence export is tenant-safe, reproducible and does not expose controlled recipient addresses", async () => {
  const password = "Evidence export password 2026";
  const owner = await createUser(
    `evidence-owner-${crypto.randomUUID()}@example.com`,
    password,
  );
  const other = await createUser(
    `evidence-other-${crypto.randomUUID()}@example.com`,
    password,
  );
  users.push(owner.id, other.id);
  const ownerSession = await login(owner.email, password, "evidence-owner");
  const otherSession = await login(other.email, password, "evidence-other");
  const recipient = "controlled@example.net";
  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Evidence baseline",
      authorizationRef: "AUTH-EVIDENCE-01",
      variables: {
        pacingProfile: "smooth",
        transportEncoding: "provider-default",
        charset: "utf-8",
        contentMode: "html",
      },
      maxRecipients: 1,
      maxAttempts: 2,
      maxDurationSeconds: 600,
      recipients: { create: [{ userId: owner.id, email: recipient }] },
    },
  });
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: 1,
      authorizationRef: "AUTH-EVIDENCE-01",
      state: "RUNNING",
      maxRecipients: 1,
      maxAttempts: 2,
      maxDurationSeconds: 600,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  await db.$transaction(async (tx) => {
    await appendExperimentEvidence(tx, {
      userId: owner.id,
      runId: run.id,
      kind: "transport.started",
      attemptId: "attempt-evidence-1",
      providerId: "provider-evidence-1",
      campaignId: "campaign-evidence-1",
      payload: {
        recipientHash: experimentRecipientHash(run.id, recipient),
        provider: { perMinute: 120 },
      },
      createdAt: new Date("2026-09-13T12:00:00.000Z"),
    });
    await appendExperimentEvidence(tx, {
      userId: owner.id,
      runId: run.id,
      kind: "transport.outcome",
      attemptId: "attempt-evidence-1",
      providerId: "provider-evidence-1",
      campaignId: "campaign-evidence-1",
      payload: { status: "accepted", providerMessageId: "safe-message-id" },
      createdAt: new Date("2026-09-13T12:00:01.000Z"),
    });
  });

  const origin = new URL(process.env.APP_URL!).origin;
  const ownerResponse = await getEvidence(
    new Request(origin + `/api/experiment-runs/${run.id}/evidence`, {
      headers: { Cookie: `${sessionCookie}=${ownerSession.token}` },
    }),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(ownerResponse.status, 200);
  assert.match(
    ownerResponse.headers.get("content-disposition") ?? "",
    /attachment/,
  );
  const body = (await ownerResponse.json()) as {
    integrity: { valid: boolean; count: number; headHash: string | null };
    run: { profile: { controlledRecipients: string[] } };
    entries: Array<{ sequence: number; previousHash: string; hash: string }>;
  };
  assert.equal(body.integrity.valid, true);
  assert.equal(body.integrity.count, 2);
  assert(body.integrity.headHash);
  assert.equal(body.entries[0]?.sequence, 1);
  assert.equal(body.entries[0]?.previousHash, "GENESIS");
  assert.equal(body.entries[1]?.sequence, 2);
  assert.equal(body.entries[1]?.previousHash, body.entries[0]?.hash);
  assert.deepEqual(body.run.profile.controlledRecipients, [
    experimentRecipientHash(run.id, recipient),
  ]);
  assert(!JSON.stringify(body).includes(recipient));

  const foreignResponse = await getEvidence(
    new Request(origin + `/api/experiment-runs/${run.id}/evidence`, {
      headers: { Cookie: `${sessionCookie}=${otherSession.token}` },
    }),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(foreignResponse.status, 404);
});
