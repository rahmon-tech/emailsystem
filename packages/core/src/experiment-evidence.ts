import { appendExperimentEvidence as appendExperimentEvidenceBase } from "./experiment-evidence-base";
import { readExperimentBurstPacingEvidence } from "./experiment-burst-pacing";
import { experimentVariables } from "./experiments-base";

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
    const [pacing, run] = await Promise.all([
      readExperimentBurstPacingEvidence(
        input.userId,
        input.runId,
        input.attemptId,
      ),
      tx.experimentRun.findFirst({
        where: { id: input.runId, userId: input.userId },
        select: { profile: { select: { variables: true } } },
      }),
    ]);
    const variables = run
      ? experimentVariables.parse(run.profile.variables)
      : null;
    if (pacing || variables) {
      const root = record(payload) ?? {};
      const controls = record(root.experimentControls) ?? {};
      payload = {
        ...root,
        experimentControls: {
          ...controls,
          ...(pacing ? { pacing } : {}),
          ...(variables
            ? {
                encoding: {
                  requestedTransportEncoding: variables.transportEncoding,
                  effectiveTransportEncoding:
                    variables.transportEncoding === "provider-default"
                      ? null
                      : variables.transportEncoding,
                  charset: variables.charset,
                },
              }
            : {}),
        },
      };
    }
  }
  return appendExperimentEvidenceBase(tx, { ...input, payload });
}
