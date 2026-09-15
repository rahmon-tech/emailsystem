import { appendExperimentEvidence as appendExperimentEvidenceBase } from "./experiment-evidence-base";
import { readExperimentBurstPacingEvidence } from "./experiment-burst-pacing";
import { experimentVariables } from "./experiments-base";

export * from "./experiment-evidence-base";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasCidInlineSnapshot(value: unknown) {
  const message = record(value);
  if (!message || typeof message.html !== "string" || !Array.isArray(message.attachments))
    return false;
  const html = message.html.toLowerCase();
  return message.attachments.some((item) => {
    const attachment = record(item);
    return (
      attachment?.disposition === "inline" &&
      typeof attachment.contentId === "string" &&
      html.includes(`cid:${attachment.contentId.toLowerCase()}`)
    );
  });
}

export async function appendExperimentEvidence(
  tx: Parameters<typeof appendExperimentEvidenceBase>[0],
  input: Parameters<typeof appendExperimentEvidenceBase>[1],
): ReturnType<typeof appendExperimentEvidenceBase> {
  let payload = input.payload;
  if (input.kind === "transport.started" && input.runId && input.attemptId) {
    const [pacing, run, campaign] = await Promise.all([
      readExperimentBurstPacingEvidence(
        input.userId,
        input.runId,
        input.attemptId,
      ),
      tx.experimentRun.findFirst({
        where: { id: input.runId, userId: input.userId },
        select: { profile: { select: { variables: true } } },
      }),
      input.campaignId
        ? tx.campaign.findFirst({
            where: { id: input.campaignId, userId: input.userId },
            select: { message: true },
          })
        : Promise.resolve(null),
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
                ...(variables.contentMode === "cid-inline"
                  ? {
                      content: {
                        requestedMode: "cid-inline",
                        effectiveMode: hasCidInlineSnapshot(campaign?.message)
                          ? "cid-inline"
                          : null,
                      },
                    }
                  : {}),
              }
            : {}),
        },
      };
    }
  }
  return appendExperimentEvidenceBase(tx, { ...input, payload });
}
