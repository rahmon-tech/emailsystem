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
  appendExperimentEvidence,
  experimentRecipientHash,
} from "./experiment-evidence-base";
import {
  acquireExperimentBurstPacing,
  commitExperimentBurstPacing,
  releaseExperimentBurstPacing,
} from "./experiment-burst-pacing";
import { waitForSafety } from "./safety";

export * from "./experiments-base";

const runSummarySelect = {
  id: true,
  profileId: true,
  profileVersion: true,
  authorizationRef: true,
  state: true,
  maxRecipients: true,
  maxAttempts: true,
  maxDurationSeconds: true,
  recipientsUsed: true,
  attemptsUsed: true,
  startsAt: true,
  expiresAt: true,
  startedAt: true,
  stoppedAt: true,
  killSwitchAt: true,
  stopReason: true,
  createdAt: true,
  updatedAt: true,
  profile: { select: { name: true } },
} as const;

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

export async function startExperimentRun(userId: string, runId: string) {
  const now = new Date();
  const [run, user] = await Promise.all([
    db.experimentRun.findFirst({
      where: { id: runId, userId },
      include: {
        profile: {
          select: {
            startAt: true,
            endAt: true,
            variables: true,
            providerScopes: {
              select: {
                providerId: true,
                provider: {
                  select: {
                    enabled: true,
                    health: true,
                    deletedAt: true,
                  },
                },
              },
            },
            senderScopes: {
              select: {
                senderIdentityId: true,
                senderIdentity: { select: { enabled: true } },
              },
            },
            recipients: { select: { email: true } },
          },
        },
      },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { experimentKillSwitchAt: true },
    }),
  ]);
  if (!run) throw new AppError(404, "NOT_FOUND", "Experiment run not found.");
  if (run.state === "RUNNING")
    return db.experimentRun.findFirstOrThrow({
      where: { id: runId, userId },
      select: runSummarySelect,
    });
  if (run.state !== "READY")
    throw new AppError(409, "EXPERIMENT_STATE", "This run cannot be started.");
  if (user?.experimentKillSwitchAt)
    throw new AppError(
      409,
      "EXPERIMENT_KILL_SWITCH",
      "Experiment transport is disabled by the account kill switch.",
    );
  if (run.profile.startAt && now < run.profile.startAt)
    throw new AppError(
      409,
      "EXPERIMENT_WINDOW",
      "This experiment is not inside its approved start window yet.",
    );
  if (run.profile.endAt && now >= run.profile.endAt)
    throw new AppError(
      409,
      "EXPERIMENT_WINDOW",
      "This experiment is outside its approved time window.",
    );
  if (
    run.profile.providerScopes.some(
      ({ provider }) => provider.health === "POLICY_BLOCKED",
    )
  )
    throw new AppError(
      409,
      "EXPERIMENT_POLICY_BLOCK",
      "A provider in this experiment scope requires policy review.",
    );
  if (
    !run.profile.providerScopes.some(
      ({ provider }) => provider.enabled && !provider.deletedAt,
    )
  )
    throw new AppError(
      409,
      "EXPERIMENT_PROVIDER_SCOPE",
      "No enabled provider is available in this experiment scope.",
    );
  if (
    !run.profile.senderScopes.some(({ senderIdentity }) => senderIdentity.enabled)
  )
    throw new AppError(
      409,
      "EXPERIMENT_SENDER_SCOPE",
      "No enabled sender is available in this experiment scope.",
    );

  const durationDeadline = new Date(
    now.getTime() + run.maxDurationSeconds * 1000,
  );
  const expiresAt =
    run.profile.endAt && run.profile.endAt < durationDeadline
      ? run.profile.endAt
      : durationDeadline;
  const variables = experimentVariables.parse(run.profile.variables);

  return db.$transaction(async (tx) => {
    const updated = await tx.experimentRun.updateMany({
      where: { id: runId, userId, state: "READY" },
      data: { state: "RUNNING", startedAt: now, expiresAt },
    });
    if (!updated.count)
      throw new AppError(
        409,
        "EXPERIMENT_STATE",
        "Experiment run state changed before it could be started.",
      );

    await appendExperimentEvidence(tx, {
      userId,
      runId,
      kind: "run.started",
      createdAt: now,
      payload: {
        authorizationRef: run.authorizationRef,
        profileVersion: run.profileVersion,
        limits: {
          maxRecipients: run.maxRecipients,
          maxAttempts: run.maxAttempts,
          maxDurationSeconds: run.maxDurationSeconds,
        },
        window: {
          approvedStartAt: run.startsAt,
          startedAt: now,
          expiresAt,
        },
        variables,
        scope: {
          providerIds: run.profile.providerScopes
            .map(({ providerId }) => providerId)
            .sort(),
          senderIdentityIds: run.profile.senderScopes
            .map(({ senderIdentityId }) => senderIdentityId)
            .sort(),
          controlledRecipientHashes: run.profile.recipients
            .map(({ email }) => experimentRecipientHash(runId, email))
            .sort(),
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        userId,
        action: "experiment.run.started",
        resourceId: runId,
      },
    });
    return tx.experimentRun.findFirstOrThrow({
      where: { id: runId, userId },
      select: runSummarySelect,
    });
  });
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
