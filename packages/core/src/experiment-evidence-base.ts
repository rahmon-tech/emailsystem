import { createHash } from "node:crypto";
import { db } from "@emailsystem/db";
import type { Prisma } from "@emailsystem/db";
import { AppError } from "./errors";

const GENESIS_HASH = "GENESIS";
const HASH_VERSION = "experiment-evidence-v1";

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = normalize(item);
    }
    return out;
  }
  return String(value);
}

export function canonicalEvidenceJson(value: unknown) {
  return JSON.stringify(normalize(value));
}

export function experimentRecipientHash(runId: string, email: string) {
  return createHash("sha256")
    .update(`${runId}\n${email.trim().toLowerCase()}`)
    .digest("hex");
}

export function experimentEvidenceHash(input: {
  runId: string;
  sequence: number;
  kind: string;
  attemptId?: string | null;
  providerId?: string | null;
  campaignId?: string | null;
  previousHash: string;
  createdAt: Date | string;
  payload: unknown;
}) {
  const createdAt =
    input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : new Date(input.createdAt).toISOString();
  return createHash("sha256")
    .update(
      [
        HASH_VERSION,
        input.runId,
        String(input.sequence),
        input.kind,
        input.attemptId ?? "",
        input.providerId ?? "",
        input.campaignId ?? "",
        input.previousHash,
        createdAt,
        canonicalEvidenceJson(input.payload),
      ].join("\n"),
    )
    .digest("hex");
}

export async function appendExperimentEvidence(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    runId: string | null;
    kind: string;
    attemptId?: string | null;
    providerId?: string | null;
    campaignId?: string | null;
    payload: unknown;
    createdAt?: Date;
  },
) {
  if (!input.runId) return null;
  await tx.$queryRaw`SELECT id FROM "ExperimentRun" WHERE id=${input.runId} AND "userId"=${input.userId} FOR UPDATE`;
  const run = await tx.experimentRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: { id: true },
  });
  if (!run)
    throw new AppError(404, "EXPERIMENT_RUN", "Experiment run not found.");
  const purged = await tx.auditEvent.findFirst({
    where: {
      userId: input.userId,
      action: "experiment.evidence.purged",
      resourceId: input.runId,
    },
    select: { id: true },
  });
  if (purged) return null;
  const last = await tx.experimentEvidence.findFirst({
    where: { userId: input.userId, runId: input.runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true, hash: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  const previousHash = last?.hash ?? GENESIS_HASH;
  const createdAt = input.createdAt ?? new Date();
  const payload = normalize(input.payload) as Prisma.InputJsonValue;
  const hash = experimentEvidenceHash({
    runId: input.runId,
    sequence,
    kind: input.kind,
    attemptId: input.attemptId,
    providerId: input.providerId,
    campaignId: input.campaignId,
    previousHash,
    createdAt,
    payload,
  });
  return tx.experimentEvidence.create({
    data: {
      userId: input.userId,
      runId: input.runId,
      sequence,
      kind: input.kind,
      attemptId: input.attemptId ?? null,
      providerId: input.providerId ?? null,
      campaignId: input.campaignId ?? null,
      payload,
      previousHash,
      hash,
      createdAt,
    },
  });
}

export function verifyExperimentEvidenceEntries(
  entries: Array<{
    runId: string;
    sequence: number;
    kind: string;
    attemptId: string | null;
    providerId: string | null;
    campaignId: string | null;
    payload: unknown;
    previousHash: string;
    hash: string;
    createdAt: Date | string;
  }>,
) {
  let previousHash = GENESIS_HASH;
  let expectedSequence = 1;
  for (const entry of entries) {
    if (
      entry.sequence !== expectedSequence ||
      entry.previousHash !== previousHash ||
      experimentEvidenceHash({
        runId: entry.runId,
        sequence: entry.sequence,
        kind: entry.kind,
        attemptId: entry.attemptId,
        providerId: entry.providerId,
        campaignId: entry.campaignId,
        previousHash: entry.previousHash,
        createdAt: entry.createdAt,
        payload: entry.payload,
      }) !== entry.hash
    )
      return {
        valid: false,
        count: entries.length,
        verifiedThrough: expectedSequence - 1,
        headHash: previousHash === GENESIS_HASH ? null : previousHash,
      };
    previousHash = entry.hash;
    expectedSequence += 1;
  }
  return {
    valid: true,
    count: entries.length,
    verifiedThrough: entries.length,
    headHash: previousHash === GENESIS_HASH ? null : previousHash,
  };
}

export async function exportExperimentEvidence(userId: string, runId: string) {
  const run = await db.experimentRun.findFirst({
    where: { id: runId, userId },
    select: {
      id: true,
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
      stopReason: true,
      createdAt: true,
      updatedAt: true,
      campaign: { select: { id: true, name: true, state: true } },
      profile: {
        select: {
          name: true,
          variables: true,
          providerScopes: {
            select: {
              providerId: true,
              provider: { select: { name: true, type: true, transport: true } },
            },
          },
          senderScopes: {
            select: {
              senderIdentityId: true,
              senderIdentity: { select: { email: true, displayName: true } },
            },
          },
          recipients: { select: { email: true } },
        },
      },
    },
  });
  if (!run) throw new AppError(404, "NOT_FOUND", "Experiment run not found.");
  const [entries, evidencePurge] = await Promise.all([
    db.experimentEvidence.findMany({
      where: { userId, runId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        runId: true,
        sequence: true,
        kind: true,
        attemptId: true,
        providerId: true,
        campaignId: true,
        payload: true,
        previousHash: true,
        hash: true,
        createdAt: true,
      },
    }),
    db.auditEvent.findFirst({
      where: {
        userId,
        action: "experiment.evidence.purged",
        resourceId: runId,
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const integrity = evidencePurge
    ? {
        available: false,
        valid: false,
        count: 0,
        verifiedThrough: 0,
        headHash: null,
      }
    : { available: true, ...verifyExperimentEvidenceEntries(entries) };
  return {
    format: HASH_VERSION,
    exportedAt: new Date(),
    run: {
      id: run.id,
      profileVersion: run.profileVersion,
      authorizationRef: run.authorizationRef,
      state: run.state,
      limits: {
        maxRecipients: run.maxRecipients,
        maxAttempts: run.maxAttempts,
        maxDurationSeconds: run.maxDurationSeconds,
      },
      usage: {
        recipientsUsed: run.recipientsUsed,
        attemptsUsed: run.attemptsUsed,
      },
      startsAt: run.startsAt,
      expiresAt: run.expiresAt,
      startedAt: run.startedAt,
      stoppedAt: run.stoppedAt,
      stopReason: run.stopReason,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      campaign: run.campaign,
      profile: {
        name: run.profile.name,
        variables: run.profile.variables,
        providers: run.profile.providerScopes,
        senders: run.profile.senderScopes,
        controlledRecipients: run.profile.recipients.map(({ email }) =>
          experimentRecipientHash(run.id, email),
        ),
      },
    },
    retention: {
      evidence: {
        status: evidencePurge ? ("purged" as const) : ("retained" as const),
        purgedAt: evidencePurge?.createdAt ?? null,
      },
    },
    integrity: {
      algorithm: "sha256",
      ...integrity,
    },
    entries,
  };
}
