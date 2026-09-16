import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { appendExperimentEvidence } from "@emailsystem/core/experiment-evidence";
import { exportExperimentEvidence } from "@emailsystem/core/experiment-evidence-base";
import { retainExperimentData } from "@emailsystem/core/experiment-retention";

const users: string[] = [];

after(async () => {
  if (users.length) {
    await db.auditEvent.deleteMany({ where: { userId: { in: users } } });
    await db.experimentEvidence.deleteMany({ where: { userId: { in: users } } });
    await db.campaign.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRunRecipientUse.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
    await db.experimentRecipient.deleteMany({ where: { userId: { in: users } } });
    await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
});

test("retention purges whole terminal evidence ledgers and sensitive message content while protecting active runs", async () => {
  const user = await db.user.create({
    data: {
      email: `experiment-retention-${crypto.randomUUID()}@example.com`,
      passwordHash: "isolated-test",
    },
  });
  users.push(user.id);

  const profile = await db.experimentProfile.create({
    data: {
      userId: user.id,
      name: "Retention proof",
      authorizationRef: "retention-proof",
      variables: {},
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 3600,
      recipients: {
        create: [{ userId: user.id, email: "controlled@example.net" }],
      },
    },
  });

  const stoppedAt = new Date("2026-01-01T12:00:00.000Z");
  const terminalRun = await db.experimentRun.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      profileVersion: profile.version,
      authorizationRef: profile.authorizationRef,
      state: "COMPLETED",
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 3600,
      startedAt: new Date(stoppedAt.getTime() - 60_000),
      stoppedAt,
      stopReason: "Completed for retention proof.",
    },
  });
  const activeRun = await db.experimentRun.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      profileVersion: profile.version,
      authorizationRef: profile.authorizationRef,
      state: "RUNNING",
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 3600,
      startedAt: new Date("2025-12-01T12:00:00.000Z"),
      expiresAt: new Date("2027-01-01T12:00:00.000Z"),
    },
  });

  const terminalSecret = `terminal-secret-${crypto.randomUUID()}`;
  const activeSecret = `active-secret-${crypto.randomUUID()}`;
  const terminalCampaign = await db.campaign.create({
    data: {
      userId: user.id,
      experimentRunId: terminalRun.id,
      name: "Terminal retention proof",
      state: "COMPLETED",
      message: {
        from: "sender@example.com",
        fromName: "Sensitive Sender",
        replyTo: "reply@example.com",
        subject: terminalSecret,
        cc: ["audit-copy@example.net"],
        bcc: ["private-copy@example.net"],
        html: `<p>${terminalSecret}</p>`,
        text: terminalSecret,
        headers: { "X-Private-Proof": terminalSecret },
        attachments: [
          {
            filename: "private.txt",
            content: terminalSecret,
            contentType: "text/plain",
            disposition: "attachment",
          },
        ],
        tags: [terminalSecret],
        snapshotHash: terminalSecret,
        tracking: { enabled: true, appUrl: "https://example.com" },
      },
      importId: `terminal-${crypto.randomUUID()}`,
      startKey: crypto.randomUUID(),
      preparedAt: stoppedAt,
      completedAt: stoppedAt,
    },
  });
  const activeCampaign = await db.campaign.create({
    data: {
      userId: user.id,
      experimentRunId: activeRun.id,
      name: "Active retention proof",
      state: "SENDING",
      message: {
        from: "sender@example.com",
        subject: activeSecret,
        cc: [],
        bcc: [],
        html: `<p>${activeSecret}</p>`,
        text: activeSecret,
        attachments: [],
        tracking: { enabled: false, appUrl: null },
      },
      importId: `active-${crypto.randomUUID()}`,
      startKey: crypto.randomUUID(),
      preparedAt: new Date("2025-12-01T12:00:00.000Z"),
    },
  });

  await db.$transaction(async (tx) => {
    await appendExperimentEvidence(tx, {
      userId: user.id,
      runId: terminalRun.id,
      kind: "run.started",
      campaignId: terminalCampaign.id,
      createdAt: new Date(stoppedAt.getTime() - 60_000),
      payload: { proof: "first" },
    });
    await appendExperimentEvidence(tx, {
      userId: user.id,
      runId: terminalRun.id,
      kind: "transport.outcome",
      campaignId: terminalCampaign.id,
      createdAt: stoppedAt,
      payload: { proof: "second" },
    });
    await appendExperimentEvidence(tx, {
      userId: user.id,
      runId: activeRun.id,
      kind: "run.started",
      campaignId: activeCampaign.id,
      createdAt: new Date("2025-12-01T12:00:00.000Z"),
      payload: { proof: "active" },
    });
  });

  const now = new Date("2026-03-01T12:00:00.000Z");
  const first = await retainExperimentData(now, {
    evidenceDays: 30,
    messageDays: 7,
  });
  assert.deepEqual(first, {
    evidenceRunsPurged: 1,
    evidenceEntriesPurged: 2,
    messageSnapshotsPurged: 1,
  });

  assert.equal(
    await db.experimentEvidence.count({ where: { runId: terminalRun.id } }),
    0,
  );
  assert.equal(
    await db.experimentEvidence.count({ where: { runId: activeRun.id } }),
    1,
  );

  const retainedTerminalCampaign = await db.campaign.findUniqueOrThrow({
    where: { id: terminalCampaign.id },
    select: { message: true },
  });
  const terminalMessageJson = JSON.stringify(retainedTerminalCampaign.message);
  assert(!terminalMessageJson.includes(terminalSecret));
  assert(!terminalMessageJson.includes("audit-copy@example.net"));
  assert(!terminalMessageJson.includes("private-copy@example.net"));
  assert(!terminalMessageJson.includes("private.txt"));
  assert.equal(
    (retainedTerminalCampaign.message as { from?: string }).from,
    "sender@example.com",
  );
  assert.equal(
    (
      retainedTerminalCampaign.message as {
        tracking?: { enabled?: boolean };
      }
    ).tracking?.enabled,
    true,
  );
  assert.equal(
    typeof (
      retainedTerminalCampaign.message as {
        retention?: { messagePurgedAt?: string };
      }
    ).retention?.messagePurgedAt,
    "string",
  );

  const retainedActiveCampaign = await db.campaign.findUniqueOrThrow({
    where: { id: activeCampaign.id },
    select: { message: true },
  });
  assert(JSON.stringify(retainedActiveCampaign.message).includes(activeSecret));

  const audit = await db.auditEvent.findMany({
    where: {
      userId: user.id,
      action: {
        in: ["experiment.evidence.purged", "experiment.message.purged"],
      },
    },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(audit.length, 2);
  assert.equal(
    audit.filter(
      (item) =>
        item.action === "experiment.evidence.purged" &&
        item.resourceId === terminalRun.id,
    ).length,
    1,
  );
  assert.equal(
    audit.filter(
      (item) =>
        item.action === "experiment.message.purged" &&
        item.resourceId === terminalCampaign.id,
    ).length,
    1,
  );

  const exported = await exportExperimentEvidence(user.id, terminalRun.id);
  const retainedExport = exported as typeof exported & {
    retention: {
      evidence: { status: "retained" | "purged"; purgedAt: Date | null };
    };
    integrity: typeof exported.integrity & { available: boolean };
  };
  assert.equal(retainedExport.entries.length, 0);
  assert.equal(retainedExport.retention.evidence.status, "purged");
  assert(retainedExport.retention.evidence.purgedAt instanceof Date);
  assert.equal(retainedExport.integrity.available, false);
  assert(!JSON.stringify(retainedExport).includes("controlled@example.net"));

  const second = await retainExperimentData(now, {
    evidenceDays: 30,
    messageDays: 7,
  });
  assert.deepEqual(second, {
    evidenceRunsPurged: 0,
    evidenceEntriesPurged: 0,
    messageSnapshotsPurged: 0,
  });
  assert.equal(
    await db.auditEvent.count({
      where: {
        userId: user.id,
        action: {
          in: ["experiment.evidence.purged", "experiment.message.purged"],
        },
      },
    }),
    2,
  );
});
