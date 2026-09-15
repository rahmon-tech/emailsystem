import { appendExperimentEvidence as appendExperimentEvidenceBase } from "./experiment-evidence-base";
import { readExperimentBurstPacingEvidence } from "./experiment-burst-pacing";

export * from "./experiment-evidence-base";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function appendExperimentEvidence(
  tx: Parameters<typeof appendExperimentEvidenceBase>[0],
  input: Parameters<typeof appendExperimentEvidenceBase>[1],
): ReturnType<typeof appendExperimentEvidenceBase> {
  let payload = input.payload;
  if (input.kind === "transport.started" && input.runId && input.attemptId) {
    const pacing = await readExperimentBurstPacingEvidence(
      input.userId,
      input.runId,
      input.attemptId,
    );
    if (pacing) {
      const root = record(payload) ?? {};
      const controls = record(root.experimentControls) ?? {};
      payload = {
        ...root,
        experimentControls: {
          ...controls,
          pacing,
        },
      };
    }
  }
  return appendExperimentEvidenceBase(tx, { ...input, payload });
}
