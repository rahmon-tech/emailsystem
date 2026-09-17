import { db } from "@emailsystem/db";
import { AppError } from "./errors";
import { exportExperimentEvidence } from "./experiment-evidence-base";

type EvidenceReviewOptions = {
  verify?: boolean;
};

export async function getExperimentEvidenceReview(
  userId: string,
  runId: string,
  options: EvidenceReviewOptions = {},
) {
  if (options.verify) {
    const exported = await exportExperimentEvidence(userId, runId);
    return {
      retention: exported.retention.evidence,
      integrity: {
        available: exported.integrity.available,
        verified: exported.integrity.available,
        valid: exported.integrity.available ? exported.integrity.valid : null,
        count: exported.integrity.count,
        verifiedThrough: exported.integrity.available
          ? exported.integrity.verifiedThrough
          : null,
        headHash: exported.integrity.headHash,
        verifiedAt: exported.integrity.available ? exported.exportedAt : null,
      },
      recent: exported.entries
        .slice(-5)
        .reverse()
        .map(({ sequence, kind, createdAt }) => ({ sequence, kind, createdAt })),
    };
  }

  const run = await db.experimentRun.findFirst({
    where: { id: runId, userId },
    select: { id: true },
  });
  if (!run) throw new AppError(404, "NOT_FOUND", "Experiment run not found.");

  const evidencePurge = await db.auditEvent.findFirst({
    where: {
      userId,
      action: "experiment.evidence.purged",
      resourceId: runId,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (evidencePurge)
    return {
      retention: {
        status: "purged" as const,
        purgedAt: evidencePurge.createdAt,
      },
      integrity: {
        available: false,
        verified: false,
        valid: null,
        count: 0,
        verifiedThrough: null,
        headHash: null,
        verifiedAt: null,
      },
      recent: [],
    };

  const [count, head, recent] = await Promise.all([
    db.experimentEvidence.count({ where: { userId, runId } }),
    db.experimentEvidence.findFirst({
      where: { userId, runId },
      orderBy: { sequence: "desc" },
      select: { hash: true },
    }),
    db.experimentEvidence.findMany({
      where: { userId, runId },
      orderBy: { sequence: "desc" },
      take: 5,
      select: { sequence: true, kind: true, createdAt: true },
    }),
  ]);

  return {
    retention: { status: "retained" as const, purgedAt: null },
    integrity: {
      available: true,
      verified: false,
      valid: null,
      count,
      verifiedThrough: null,
      headHash: head?.hash ?? null,
      verifiedAt: null,
    },
    recent,
  };
}
