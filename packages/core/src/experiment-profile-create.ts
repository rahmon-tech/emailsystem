import { db } from "@emailsystem/db";
import { z } from "zod";
import { AppError } from "./errors";
import { experimentVariables } from "./experiments";

const inputSchema = z
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

function unique(values: string[]) {
  return [...new Set(values)];
}

export async function createExperimentProfileAtomic(
  userId: string,
  raw: unknown,
) {
  const input = inputSchema.parse(raw);
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

    await tx.experimentProviderScope.createMany({
      data: providerIds.map((providerId) => ({
        userId,
        profileId: profile.id,
        providerId,
      })),
    });
    await tx.experimentSenderScope.createMany({
      data: senderIdentityIds.map((senderIdentityId) => ({
        userId,
        profileId: profile.id,
        senderIdentityId,
      })),
    });
    await tx.experimentRecipient.createMany({
      data: recipients.map((email) => ({
        userId,
        profileId: profile.id,
        email,
      })),
    });
    await tx.auditEvent.create({
      data: {
        userId,
        action: "experiment.profile.created",
        resourceId: profile.id,
      },
    });

    return tx.experimentProfile.findFirstOrThrow({
      where: { id: profile.id, userId },
      select: profileSummarySelect,
    });
  });
}
