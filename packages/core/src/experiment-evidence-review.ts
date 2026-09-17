import { exportExperimentEvidence } from "./experiment-evidence-base";

export async function getExperimentEvidenceReview(userId: string, runId: string) {
  const exported = await exportExperimentEvidence(userId, runId);
  return {
    retention: exported.retention.evidence,
    integrity: {
      available: exported.integrity.available,
      valid: exported.integrity.valid,
      count: exported.integrity.count,
      verifiedThrough: exported.integrity.verifiedThrough,
      headHash: exported.integrity.headHash,
    },
    recent: exported.entries
      .slice(-5)
      .reverse()
      .map(({ sequence, kind, createdAt }) => ({ sequence, kind, createdAt })),
  };
}
