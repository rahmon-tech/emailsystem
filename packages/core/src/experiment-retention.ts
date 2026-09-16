import { db } from "@emailsystem/db";
import type { Prisma } from "@emailsystem/db";

const DAY_MS = 86_400_000;
const DEFAULT_EVIDENCE_DAYS = 365;
const DEFAULT_MESSAGE_DAYS = 30;
const RETENTION_VERSION = "experiment-retention-v1";
const TERMINAL_STATES = new Set(["STOPPED", "COMPLETED", "EXPIRED"]);

export type ExperimentRetentionPolicy = {
  evidenceDays?: number;
  messageDays?: number;
};

function retentionDays(value: number | undefined, fallback: number) {
  const days = value ?? fallback;
  if (!Number.isInteger(days) || days < 1)
    throw new Error("Experiment retention days must be a positive integer.");
  return days;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function messageAlreadyPurged(value: unknown) {
  const retention = record(record(value)?.retention);
  return typeof retention?.messagePurgedAt === "string";
}

function scrubMessageSnapshot(value: unknown, purgedAt: Date) {
  const message = record(value) ?? {};
  const tracking = record(message.tracking);
  return {
    from: typeof message.from === "string" ? message.from : "",
    fromName: "",
    replyTo: "",
    subject: "",
    cc: [],
    bcc: [],
    html: "",
    text: "",
    headers: {},
    attachments: [],
    tags: [],
    snapshotHash: "",
    tracking: {
      enabled: tracking?.enabled === true,
      appUrl: null,
    },
    retention: {
      version: RETENTION_VERSION,
      messagePurgedAt: purgedAt.toISOString(),
    },
  } as Prisma.InputJsonValue;
}

function isEligibleTerminalRun(
  run: { state: string; stoppedAt: Date | null } | null,
  cutoff: Date,
) {
  return (
    !!run &&
    TERMINAL_STATES.has(run.state) &&
    !!run.stoppedAt &&
    run.stoppedAt < cutoff
  );
}

export async function retainExperimentData(
  now = new Date(),
  policy: ExperimentRetentionPolicy = {},
) {
  const evidenceDays = retentionDays(policy.evidenceDays, DEFAULT_EVIDENCE_DAYS);
  const messageDays = retentionDays(policy.messageDays, DEFAULT_MESSAGE_DAYS);
  const evidenceCutoff = new Date(now.getTime() - evidenceDays * DAY_MS);
  const messageCutoff = new Date(now.getTime() - messageDays * DAY_MS);

  let evidenceRunsPurged = 0;
  let evidenceEntriesPurged = 0;
  let messageSnapshotsPurged = 0;

  const evidenceCandidates = await db.experimentRun.findMany({
    where: {
      state: { in: ["STOPPED", "COMPLETED", "EXPIRED"] },
      stoppedAt: { lt: evidenceCutoff },
      evidence: { some: {} },
    },
    select: { id: true, userId: true },
    take: 250,
  });

  for (const candidate of evidenceCandidates) {
    const purged = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExperimentRun" WHERE id=${candidate.id} AND "userId"=${candidate.userId} FOR UPDATE`;
      const run = await tx.experimentRun.findFirst({
        where: { id: candidate.id, userId: candidate.userId },
        select: { state: true, stoppedAt: true },
      });
      if (!isEligibleTerminalRun(run, evidenceCutoff)) return 0;

      const removed = await tx.experimentEvidence.deleteMany({
        where: { userId: candidate.userId, runId: candidate.id },
      });
      if (!removed.count) return 0;

      await tx.auditEvent.create({
        data: {
          userId: candidate.userId,
          action: "experiment.evidence.purged",
          resourceId: candidate.id,
          createdAt: now,
        },
      });
      return removed.count;
    });
    if (purged) {
      evidenceRunsPurged += 1;
      evidenceEntriesPurged += purged;
    }
  }

  const messageRuns = await db.experimentRun.findMany({
    where: {
      state: { in: ["STOPPED", "COMPLETED", "EXPIRED"] },
      stoppedAt: { lt: messageCutoff },
      campaign: { isNot: null },
    },
    select: { id: true },
    take: 500,
  });
  const messageRunIds = messageRuns.map(({ id }) => id);
  const campaigns = messageRunIds.length
    ? await db.campaign.findMany({
        where: { experimentRunId: { in: messageRunIds } },
        select: { id: true, userId: true, message: true },
      })
    : [];

  for (const candidate of campaigns) {
    if (messageAlreadyPurged(candidate.message)) continue;
    const purged = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${candidate.id} AND "userId"=${candidate.userId} FOR UPDATE`;
      const campaign = await tx.campaign.findFirst({
        where: { id: candidate.id, userId: candidate.userId },
        select: {
          message: true,
          experimentRun: { select: { state: true, stoppedAt: true } },
        },
      });
      if (
        !campaign ||
        !isEligibleTerminalRun(campaign.experimentRun, messageCutoff) ||
        messageAlreadyPurged(campaign.message)
      )
        return false;

      await tx.campaign.update({
        where: { id: candidate.id },
        data: { message: scrubMessageSnapshot(campaign.message, now) },
      });
      await tx.auditEvent.create({
        data: {
          userId: candidate.userId,
          action: "experiment.message.purged",
          resourceId: candidate.id,
          createdAt: now,
        },
      });
      return true;
    });
    if (purged) messageSnapshotsPurged += 1;
  }

  return {
    evidenceRunsPurged,
    evidenceEntriesPurged,
    messageSnapshotsPurged,
  };
}
