import { db } from "@emailsystem/db";
import type { Prisma } from "@emailsystem/db";
import { z } from "zod";
import { AppError } from "./errors";

export const experimentVariables = z
  .object({
    pacingProfile: z.enum(["smooth", "bounded-burst"]).default("smooth"),
    pacingIntervalMs: z.number().int().min(0).max(60_000).optional(),
    concurrency: z.number().int().min(1).max(50).optional(),
    transportEncoding: z
      .enum(["provider-default", "quoted-printable", "base64"])
      .default("provider-default"),
    charset: z.literal("utf-8").default("utf-8"),
    contentMode: z
      .enum([
        "html",
        "text",
        "cid-inline",
        "hosted-image",
        "attachment-only",
        "image-dominant",
      ])
      .default("html"),
  })
  .strict();

const createProfileInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    authorizationRef: z.string().trim().min(3).max(200),
    description: z.string().trim().max(1000).default(""),
    providerIds: z.array(z.uuid()).min(1).max(20),
    senderIdentityIds: z.array(z.uuid()).min(1).max(20),
    recipients: z
      .array(z.email().transform((value) => value.trim().toLowerCase()))
      .min(1)
      .max(1000),
    maxRecipients: z.number().int().min(1).max(10_000),
    maxAttempts: z.number().int().min(1).max(50_000),
    maxDurationSeconds: z.number().int().min(60).max(86_400),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    variables: experimentVariables.default({
      pacingProfile: "smooth",
      transportEncoding: "provider-default",
      charset: "utf-8",
      contentMode: "html",
    }),
  })
  .strict();

const profileSummarySelect = {
  id: true,
  name: true,
  version: true,
  authorizationRef: true,
  description: true,
  variables: true,
  maxRecipients: true,
  maxAttempts: true,
  maxDurationSeconds: true,
  startAt: true,
  endAt: true,
  createdAt: true,
  providerScopes: {
    select: {
      provider: {
        select: { id: true, name: true, type: true, transport: true },
      },
    },
  },
  senderScopes: {
    select: {
      senderIdentity: { select: { id: true, email: true, displayName: true } },
    },
  },
  _count: { select: { recipients: true, runs: true } },
} as const;

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

function unique(values: string[]) {
  return [...new Set(values)];
}

async function lockExperimentControl(
  tx: Prisma.TransactionClient,
  userId: string,
  runId: string,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "ExperimentRun" WHERE id=${runId} AND "userId"=${userId} FOR UPDATE`;
}

function activeWindowProblem(
  run: { startsAt: Date | null; expiresAt: Date | null },
  now: Date,
) {
  if (run.startsAt && now < run.startsAt)
    return "This experiment is not inside its approved start window yet.";
  if (!run.expiresAt)
    return "This experiment run has not been started with a bounded expiry.";
  if (now >= run.expiresAt)
    return "This experiment run is outside its approved time window.";
  return null;
}

export async function validateExperimentCampaignScope(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    runId: string;
    senderIdentityId: string;
    importId: string;
    eligibleProviderIds: string[];
    copyRecipients?: string[];
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await lockExperimentControl(tx, input.userId, input.runId);
  const [user, run] = await Promise.all([
    tx.user.findUnique({
      where: { id: input.userId },
      select: { experimentKillSwitchAt: true },
    }),
    tx.experimentRun.findFirst({
      where: { id: input.runId, userId: input.userId },
      select: {
        id: true,
        profileId: true,
        state: true,
        maxRecipients: true,
        maxAttempts: true,
        recipientsUsed: true,
        attemptsUsed: true,
        startsAt: true,
        expiresAt: true,
        campaign: { select: { id: true } },
        profile: {
          select: {
            providerScopes: { select: { providerId: true } },
            senderScopes: { select: { senderIdentityId: true } },
            recipients: { select: { email: true } },
          },
        },
      },
    }),
  ]);
  if (!run)
    throw new AppError(404, "EXPERIMENT_RUN", "Experiment run not found.");
  if (user?.experimentKillSwitchAt)
    throw new AppError(
      409,
      "EXPERIMENT_KILL_SWITCH",
      "Experiment transport is disabled by the account kill switch.",
    );
  if (run.state !== "RUNNING")
    throw new AppError(
      409,
      "EXPERIMENT_STATE",
      "The experiment run must be running before a campaign can use it.",
    );
  const windowProblem = activeWindowProblem(run, now);
  if (windowProblem)
    throw new AppError(409, "EXPERIMENT_WINDOW", windowProblem);
  if (run.campaign)
    throw new AppError(
      409,
      "EXPERIMENT_RUN_BOUND",
      "This experiment run is already bound to a campaign.",
    );
  if (
    !run.profile.senderScopes.some(
      (scope) => scope.senderIdentityId === input.senderIdentityId,
    )
  )
    throw new AppError(
      422,
      "EXPERIMENT_SENDER_SCOPE",
      "The selected sender is outside the approved experiment scope.",
    );
  const eligible = new Set(input.eligibleProviderIds);
  const providerIds = run.profile.providerScopes
    .map((scope) => scope.providerId)
    .filter((providerId) => eligible.has(providerId));
  if (!providerIds.length)
    throw new AppError(
      422,
      "EXPERIMENT_PROVIDER_SCOPE",
      "No healthy eligible provider is inside the approved experiment scope.",
    );
  const importCount = await tx.importRecipient.count({
    where: { importId: input.importId, userId: input.userId },
  });
  if (importCount > run.maxRecipients)
    throw new AppError(
      422,
      "EXPERIMENT_RECIPIENT_LIMIT",
      "The campaign recipient count exceeds the experiment recipient ceiling.",
    );
  const allowedRecipients = run.profile.recipients.map((item) => item.email);
  const outsideAllowlist = await tx.importRecipient.count({
    where: {
      importId: input.importId,
      userId: input.userId,
      email: { notIn: allowedRecipients },
    },
  });
  const copiesOutside = (input.copyRecipients ?? []).some(
    (email) => !allowedRecipients.includes(email),
  );
  if (outsideAllowlist || copiesOutside)
    throw new AppError(
      422,
      "EXPERIMENT_RECIPIENT_SCOPE",
      "Every campaign recipient and copy address must be on the controlled experiment allowlist.",
    );
  if (
    run.recipientsUsed > run.maxRecipients ||
    run.attemptsUsed > run.maxAttempts
  )
    throw new AppError(
      409,
      "EXPERIMENT_LIMIT_STATE",
      "Experiment usage counters exceed their approved ceiling and require review.",
    );
  return {
    runId: run.id,
    providerIds,
    maxRecipients: run.maxRecipients,
    maxAttempts: run.maxAttempts,
  };
}

export async function experimentDispatchScope(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    runId: string | null;
    senderIdentityId: string;
    now?: Date;
  },
): Promise<
  | { allowed: true; providerIds: string[] | null }
  | { allowed: false; reason: string }
> {
  if (!input.runId) return { allowed: true, providerIds: null };
  const now = input.now ?? new Date();
  const [user, run] = await Promise.all([
    tx.user.findUnique({
      where: { id: input.userId },
      select: { experimentKillSwitchAt: true },
    }),
    tx.experimentRun.findFirst({
      where: { id: input.runId, userId: input.userId },
      select: {
        id: true,
        state: true,
        attemptsUsed: true,
        maxAttempts: true,
        startsAt: true,
        expiresAt: true,
        profile: {
          select: {
            providerScopes: { select: { providerId: true } },
            senderScopes: { select: { senderIdentityId: true } },
          },
        },
      },
    }),
  ]);
  if (!run) return { allowed: false, reason: "Experiment run is unavailable." };
  if (user?.experimentKillSwitchAt)
    return {
      allowed: false,
      reason: "Experiment transport is disabled by the account kill switch.",
    };
  if (run.state !== "RUNNING")
    return { allowed: false, reason: "Experiment run is not active." };
  const windowProblem = activeWindowProblem(run, now);
  if (windowProblem) {
    if (run.expiresAt && now >= run.expiresAt)
      await tx.experimentRun.updateMany({
        where: { id: run.id, userId: input.userId, state: "RUNNING" },
        data: {
          state: "EXPIRED",
          stoppedAt: now,
          stopReason: "Experiment run expired.",
        },
      });
    return { allowed: false, reason: windowProblem };
  }
  if (run.attemptsUsed >= run.maxAttempts) {
    await tx.experimentRun.updateMany({
      where: { id: run.id, userId: input.userId, state: "RUNNING" },
      data: {
        state: "COMPLETED",
        stoppedAt: now,
        stopReason: "Experiment attempt ceiling reached.",
      },
    });
    return {
      allowed: false,
      reason: "Experiment attempt ceiling reached; no further transport starts are allowed.",
    };
  }
  if (
    !run.profile.senderScopes.some(
      (scope) => scope.senderIdentityId === input.senderIdentityId,
    )
  )
    return {
      allowed: false,
      reason: "Campaign sender is outside the approved experiment scope.",
    };
  return {
    allowed: true,
    providerIds: run.profile.providerScopes.map((scope) => scope.providerId),
  };
}

export async function reserveExperimentTransport(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    runId: string | null;
    campaignId: string;
    senderIdentityId: string;
    providerId: string;
    recipient: string;
    attemptId: string;
    now?: Date;
  },
): Promise<
  | { allowed: true; experimentRunId: string | null }
  | { allowed: false; reason: string }
> {
  if (!input.runId) return { allowed: true, experimentRunId: null };
  const now = input.now ?? new Date();
  await lockExperimentControl(tx, input.userId, input.runId);
  const [user, run] = await Promise.all([
    tx.user.findUnique({
      where: { id: input.userId },
      select: { experimentKillSwitchAt: true },
    }),
    tx.experimentRun.findFirst({
      where: { id: input.runId, userId: input.userId },
      select: {
        id: true,
        profileId: true,
        state: true,
        maxRecipients: true,
        maxAttempts: true,
        recipientsUsed: true,
        attemptsUsed: true,
        startsAt: true,
        expiresAt: true,
        campaign: { select: { id: true } },
        profile: {
          select: {
            providerScopes: { select: { providerId: true } },
            senderScopes: { select: { senderIdentityId: true } },
          },
        },
      },
    }),
  ]);
  if (!run) return { allowed: false, reason: "Experiment run is unavailable." };
  if (user?.experimentKillSwitchAt) {
    await tx.experimentRun.updateMany({
      where: { id: run.id, userId: input.userId, state: "RUNNING" },
      data: {
        state: "STOPPED",
        stoppedAt: now,
        killSwitchAt: user.experimentKillSwitchAt,
        stopReason: "Stopped by account experiment kill switch.",
      },
    });
    return {
      allowed: false,
      reason: "Experiment transport is disabled by the account kill switch.",
    };
  }
  if (run.state !== "RUNNING")
    return { allowed: false, reason: "Experiment run is not active." };
  const windowProblem = activeWindowProblem(run, now);
  if (windowProblem) {
    if (run.expiresAt && now >= run.expiresAt)
      await tx.experimentRun.update({
        where: { id: run.id },
        data: {
          state: "EXPIRED",
          stoppedAt: now,
          stopReason: "Experiment run expired.",
        },
      });
    return { allowed: false, reason: windowProblem };
  }
  if (run.campaign?.id !== input.campaignId)
    return {
      allowed: false,
      reason: "Experiment run is not bound to this campaign.",
    };
  if (
    !run.profile.senderScopes.some(
      (scope) => scope.senderIdentityId === input.senderIdentityId,
    )
  )
    return {
      allowed: false,
      reason: "Campaign sender is outside the approved experiment scope.",
    };
  if (
    !run.profile.providerScopes.some(
      (scope) => scope.providerId === input.providerId,
    )
  )
    return {
      allowed: false,
      reason: "Selected provider is outside the approved experiment scope.",
    };
  if (
    !(await tx.experimentRecipient.count({
      where: {
        userId: input.userId,
        profileId: run.profileId,
        email: input.recipient,
      },
    }))
  )
    return {
      allowed: false,
      reason: "Recipient is outside the controlled experiment allowlist.",
    };
  if (run.attemptsUsed >= run.maxAttempts) {
    await tx.experimentRun.update({
      where: { id: run.id },
      data: {
        state: "COMPLETED",
        stoppedAt: now,
        stopReason: "Experiment attempt ceiling reached.",
      },
    });
    return {
      allowed: false,
      reason: "Experiment attempt ceiling reached; no further transport starts are allowed.",
    };
  }
  const usedRecipient = await tx.experimentRunRecipientUse.findUnique({
    where: {
      runId_email: { runId: run.id, email: input.recipient },
    },
  });
  if (!usedRecipient && run.recipientsUsed >= run.maxRecipients) {
    await tx.experimentRun.update({
      where: { id: run.id },
      data: {
        state: "STOPPED",
        stoppedAt: now,
        stopReason: "Experiment recipient ceiling would be exceeded.",
      },
    });
    return {
      allowed: false,
      reason: "Experiment recipient ceiling reached; this recipient cannot start transport.",
    };
  }
  if (!usedRecipient)
    await tx.experimentRunRecipientUse.create({
      data: {
        userId: input.userId,
        runId: run.id,
        email: input.recipient,
        firstUsedAt: now,
      },
    });
  const nextAttempts = run.attemptsUsed + 1;
  await tx.experimentRun.update({
    where: { id: run.id },
    data: {
      attemptsUsed: { increment: 1 },
      ...(!usedRecipient ? { recipientsUsed: { increment: 1 } } : {}),
      ...(nextAttempts >= run.maxAttempts
        ? {
            state: "COMPLETED" as const,
            stoppedAt: now,
            stopReason: "Experiment attempt ceiling reached.",
          }
        : {}),
    },
  });
  await tx.auditEvent.create({
    data: {
      userId: input.userId,
      action: "experiment.transport.started",
      resourceId: input.attemptId,
    },
  });
  return { allowed: true, experimentRunId: run.id };
}

export async function listExperimentProfiles(userId: string) {
  return db.experimentProfile.findMany({
    where: { userId },
    select: profileSummarySelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function createExperimentProfile(userId: string, raw: unknown) {
  const input = createProfileInput.parse(raw);
  const providerIds = unique(input.providerIds);
  const senderIdentityIds = unique(input.senderIdentityIds);
  const recipients = unique(input.recipients);

  if (input.maxRecipients > recipients.length)
    throw new AppError(
      422,
      "EXPERIMENT_RECIPIENT_LIMIT",
      "The recipient ceiling cannot exceed the controlled recipient allowlist.",
    );
  if (
    input.maxAttempts < input.maxRecipients ||
    input.maxAttempts > input.maxRecipients * 5
  )
    throw new AppError(
      422,
      "EXPERIMENT_ATTEMPT_LIMIT",
      "The attempt ceiling must be between the recipient ceiling and five attempts per recipient.",
    );
  if (input.startAt && input.endAt && input.endAt <= input.startAt)
    throw new AppError(
      422,
      "EXPERIMENT_WINDOW",
      "The experiment end time must be after its start time.",
    );
  if (input.endAt && input.endAt <= new Date())
    throw new AppError(
      422,
      "EXPERIMENT_WINDOW",
      "The experiment end time must be in the future.",
    );

  const [providers, senders] = await Promise.all([
    db.providerConnection.findMany({
      where: { userId, id: { in: providerIds }, deletedAt: null },
      select: { id: true },
    }),
    db.senderIdentity.findMany({
      where: { userId, id: { in: senderIdentityIds } },
      select: { id: true },
    }),
  ]);
  if (providers.length !== providerIds.length)
    throw new AppError(
      422,
      "EXPERIMENT_PROVIDER_SCOPE",
      "Every provider in the experiment scope must belong to this account.",
    );
  if (senders.length !== senderIdentityIds.length)
    throw new AppError(
      422,
      "EXPERIMENT_SENDER_SCOPE",
      "Every sender in the experiment scope must belong to this account.",
    );

  return db.$transaction(async (tx) => {
    const profile = await tx.experimentProfile.create({
      data: {
        userId,
        name: input.name,
        authorizationRef: input.authorizationRef,
        description: input.description,
        variables: input.variables,
        maxRecipients: input.maxRecipients,
        maxAttempts: input.maxAttempts,
        maxDurationSeconds: input.maxDurationSeconds,
        startAt: input.startAt,
        endAt: input.endAt,
      },
      select: { id: true },
    });
    await Promise.all([
      tx.experimentProviderScope.createMany({
        data: providerIds.map((providerId) => ({
          userId,
          profileId: profile.id,
          providerId,
        })),
      }),
      tx.experimentSenderScope.createMany({
        data: senderIdentityIds.map((senderIdentityId) => ({
          userId,
          profileId: profile.id,
          senderIdentityId,
        })),
      }),
      tx.experimentRecipient.createMany({
        data: recipients.map((email) => ({
          userId,
          profileId: profile.id,
          email,
        })),
      }),
    ]);
    await tx.auditEvent.create({
      data: {
        userId,
        action: "experiment.profile.created",
        resourceId: profile.id,
      },
    });
    return tx.experimentProfile.findUniqueOrThrow({
      where: { id: profile.id },
      select: profileSummarySelect,
    });
  });
}

export async function listExperimentRuns(userId: string) {
  return db.experimentRun.findMany({
    where: { userId },
    select: runSummarySelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function createExperimentRun(userId: string, profileId: string) {
  const [profile, user] = await Promise.all([
    db.experimentProfile.findFirst({
      where: { id: profileId, userId },
      select: {
        id: true,
        version: true,
        authorizationRef: true,
        maxRecipients: true,
        maxAttempts: true,
        maxDurationSeconds: true,
        startAt: true,
        endAt: true,
      },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { experimentKillSwitchAt: true },
    }),
  ]);
  if (!profile)
    throw new AppError(404, "NOT_FOUND", "Experiment profile not found.");
  if (user?.experimentKillSwitchAt)
    throw new AppError(
      409,
      "EXPERIMENT_KILL_SWITCH",
      "Experiment transport is disabled by the account kill switch.",
    );
  if (profile.endAt && profile.endAt <= new Date())
    throw new AppError(
      409,
      "EXPERIMENT_WINDOW",
      "This experiment profile is outside its approved time window.",
    );

  return db.$transaction(async (tx) => {
    const run = await tx.experimentRun.create({
      data: {
        userId,
        profileId: profile.id,
        profileVersion: profile.version,
        authorizationRef: profile.authorizationRef,
        maxRecipients: profile.maxRecipients,
        maxAttempts: profile.maxAttempts,
        maxDurationSeconds: profile.maxDurationSeconds,
        startsAt: profile.startAt,
      },
      select: runSummarySelect,
    });
    await tx.auditEvent.create({
      data: {
        userId,
        action: "experiment.run.created",
        resourceId: run.id,
      },
    });
    return run;
  });
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
            providerScopes: {
              select: {
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
              select: { senderIdentity: { select: { enabled: true } } },
            },
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

export async function stopExperimentRun(
  userId: string,
  runId: string,
  reason = "Stopped by operator.",
) {
  const current = await db.experimentRun.findFirst({
    where: { id: runId, userId },
    select: { state: true },
  });
  if (!current) throw new AppError(404, "NOT_FOUND", "Experiment run not found.");
  if (current.state === "STOPPED")
    return db.experimentRun.findFirstOrThrow({
      where: { id: runId, userId },
      select: runSummarySelect,
    });
  if (!(["READY", "RUNNING"] as const).includes(current.state as "READY" | "RUNNING"))
    throw new AppError(409, "EXPERIMENT_STATE", "This run cannot be stopped.");

  const now = new Date();
  const safeReason = reason.trim().slice(0, 300) || "Stopped by operator.";
  return db.$transaction(async (tx) => {
    const updated = await tx.experimentRun.updateMany({
      where: { id: runId, userId, state: { in: ["READY", "RUNNING"] } },
      data: {
        state: "STOPPED",
        stoppedAt: now,
        killSwitchAt: now,
        stopReason: safeReason,
      },
    });
    if (!updated.count)
      throw new AppError(
        409,
        "EXPERIMENT_STATE",
        "Experiment run state changed before it could be stopped.",
      );
    await tx.auditEvent.create({
      data: {
        userId,
        action: "experiment.run.stopped",
        resourceId: runId,
      },
    });
    return tx.experimentRun.findFirstOrThrow({
      where: { id: runId, userId },
      select: runSummarySelect,
    });
  });
}

export async function experimentKillSwitchStatus(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      experimentKillSwitchAt: true,
      experimentKillSwitchReason: true,
    },
  });
  return {
    engaged: Boolean(user.experimentKillSwitchAt),
    at: user.experimentKillSwitchAt,
    reason: user.experimentKillSwitchReason,
  };
}

export async function setExperimentKillSwitch(
  userId: string,
  engaged: boolean,
  reason = "",
) {
  const now = new Date();
  const safeReason = reason.trim().slice(0, 300);
  return db.$transaction(async (tx) => {
    if (engaged) {
      const finalReason = safeReason || "Stopped by account experiment kill switch.";
      await tx.user.update({
        where: { id: userId },
        data: {
          experimentKillSwitchAt: now,
          experimentKillSwitchReason: finalReason,
        },
      });
      await tx.experimentRun.updateMany({
        where: { userId, state: { in: ["READY", "RUNNING"] } },
        data: {
          state: "STOPPED",
          stoppedAt: now,
          killSwitchAt: now,
          stopReason: finalReason,
        },
      });
      await tx.auditEvent.create({
        data: {
          userId,
          action: "experiment.kill_switch.engaged",
          resourceId: userId,
        },
      });
    } else {
      await tx.user.update({
        where: { id: userId },
        data: {
          experimentKillSwitchAt: null,
          experimentKillSwitchReason: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          userId,
          action: "experiment.kill_switch.cleared",
          resourceId: userId,
        },
      });
    }
    return {
      engaged,
      at: engaged ? now : null,
      reason: engaged
        ? safeReason || "Stopped by account experiment kill switch."
        : null,
    };
  });
}