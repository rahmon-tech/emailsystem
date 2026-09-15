import { appendExperimentEvidence as appendExperimentEvidenceBase } from "./experiment-evidence-base";
import { readExperimentBurstPacingEvidence } from "./experiment-burst-pacing";
import { experimentVariables } from "./experiments-base";

export * from "./experiment-evidence-base";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasHtmlSnapshot(value: unknown) {
  const message = record(value);
  return !!message && typeof message.html === "string" && message.html.length > 0;
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

function contentEvidence(contentMode: string, snapshot: unknown) {
  if (contentMode === "cid-inline")
    return {
      requestedMode: "cid-inline",
      effectiveMode: hasCidInlineSnapshot(snapshot) ? "cid-inline" : null,
    };
  if (contentMode === "html")
    return {
      requestedMode: "html",
      effectiveMode: hasHtmlSnapshot(snapshot) ? "html" : null,
    };
  return null;
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
      const content = variables
        ? contentEvidence(variables.contentMode, campaign?.message)
        : null;
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
                ...(content ? { content } : {}),
              }
            : {}),
        },
      };
    }
  }
  return appendExperimentEvidenceBase(tx, { ...input, payload });
}
