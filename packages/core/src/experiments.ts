import { db } from "@emailsystem/db";
import {
  supportsExplicitTransportEncoding,
  supportsInlineAttachmentTransport,
} from "@emailsystem/providers/capabilities";
import { AppError } from "./errors";
import {
  createExperimentProfile as createExperimentProfileBase,
  experimentVariables,
  reserveExperimentTransport as reserveExperimentTransportBase,
} from "./experiments-base";
import {
  acquireExperimentBurstPacing,
  commitExperimentBurstPacing,
  releaseExperimentBurstPacing,
} from "./experiment-burst-pacing";
import { waitForSafety } from "./safety";

export * from "./experiments-base";

export async function createExperimentProfile(userId: string, raw: unknown) {
  const candidate =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const variables = experimentVariables.parse(candidate.variables ?? {});
  const providerIds = Array.isArray(candidate.providerIds)
    ? candidate.providerIds.filter(
        (providerId): providerId is string => typeof providerId === "string",
      )
    : [];
  const completeProviderIds =
    providerIds.length === (candidate.providerIds as unknown[] | undefined)?.length;
  const needsProviderCapabilities =
    variables.transportEncoding !== "provider-default" ||
    variables.contentMode === "cid-inline";

  if (needsProviderCapabilities && completeProviderIds) {
    const providers = await db.providerConnection.findMany({
      where: { userId, id: { in: providerIds }, deletedAt: null },
      select: { id: true, type: true, transport: true },
    });
    if (
      variables.transportEncoding !== "provider-default" &&
      providers.some(
        (provider) => !supportsExplicitTransportEncoding(provider),
      )
    )
      throw new AppError(
        422,
        "EXPERIMENT_TRANSPORT_ENCODING",
        "Explicit experiment transfer encoding requires raw MIME SMTP or SES providers.",
      );
    if (
      variables.contentMode === "cid-inline" &&
      providers.some(
        (provider) => !supportsInlineAttachmentTransport(provider),
      )
    )
      throw new AppError(
        422,
        "EXPERIMENT_CONTENT_MODE",
        "CID-inline experiment content requires providers that support inline CID attachments.",
      );
  }

  return createExperimentProfileBase(userId, raw);
}

export async function reserveExperimentTransport(
  tx: Parameters<typeof reserveExperimentTransportBase>[0],
  input: Parameters<typeof reserveExperimentTransportBase>[1],
): ReturnType<typeof reserveExperimentTransportBase> {
  if (!input.runId) return reserveExperimentTransportBase(tx, input);

  const now = input.now ?? new Date();
  const run = await tx.experimentRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: {
      state: true,
      expiresAt: true,
      profile: { select: { variables: true } },
    },
  });
  if (!run || run.state !== "RUNNING" || (run.expiresAt && now >= run.expiresAt))
    return reserveExperimentTransportBase(tx, input);

  const variables = experimentVariables.parse(run.profile.variables);
  if (variables.pacingProfile !== "bounded-burst")
    return reserveExperimentTransportBase(tx, input);

  const windowMs = variables.pacingIntervalMs!;
  const burstSize = variables.pacingBurstSize!;
  const permit = await acquireExperimentBurstPacing(
    input.userId,
    input.runId,
    input.attemptId,
    windowMs,
    burstSize,
  );
  if (!permit.allowed) {
    const campaign = await tx.campaign.findFirst({
      where: { id: input.campaignId, userId: input.userId },
      select: {
        id: true,
        userId: true,
        safetyWaitReason: true,
        safetyWaitUntil: true,
      },
    });
    if (campaign)
      await waitForSafety(
        tx,
        campaign,
        [],
        permit.nextAllowedAt,
        now.getTime(),
        "Experiment bounded burst window is full.",
      );
    return {
      allowed: false,
      retryable: true,
      reason: "Experiment bounded burst window is full.",
    };
  }

  try {
    const reservation = await reserveExperimentTransportBase(tx, input);
    if (!reservation.allowed) {
      await releaseExperimentBurstPacing(input.userId, input.runId, input.attemptId);
      return reservation;
    }
    const committed = await commitExperimentBurstPacing(
      input.userId,
      input.runId,
      input.attemptId,
      {
        windowMs,
        burstSize,
        occupancyBeforeStart: permit.occupancyBeforeStart,
        occupancyAfterStart: permit.occupancyAfterStart,
      },
    );
    if (!committed)
      throw new Error(
        "Experiment bounded-burst reservation expired before transport start.",
      );
    return reservation;
  } catch (error) {
    await releaseExperimentBurstPacing(input.userId, input.runId, input.attemptId);
    throw error;
  }
}
