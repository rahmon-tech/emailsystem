import {
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
