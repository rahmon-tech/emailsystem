import { db, type Prisma } from "@emailsystem/db";
import { z } from "zod";
import { redis } from "./redis";
import { AppError } from "./errors";
import {
  dailyBudget,
  safetySettings,
  type SafetySettings,
} from "./safety-config";
import {
  RollingGovernor,
  WINDOW_MS,
  RESERVATION_MS,
  type Budget,
  type RestoredUsage,
} from "./safety-governor";

export const DAILY_WAIT =
  "Daily safety limit reached · sending resumes as capacity becomes available";
export async function lockSafety(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"safety:" + userId},0))::text`;
}
export function senderDomain(from: string) {
  return from.split("@")[1].toLowerCase();
}
export function commonBudgets(
  settings: SafetySettings,
  domain: string,
  campaignId?: string,
  campaignLimit?: number | null,
): Budget[] {
  return [
    { scope: "account", limit: settings.accountDaily },
    { scope: "domain:" + domain, limit: settings.domainDaily },
    ...(campaignId
      ? [{ scope: "campaign:" + campaignId, limit: campaignLimit ?? null }]
      : []),
  ];
}
// Caller holds the same PostgreSQL account lock used for reserve/claim/start.
// A Redis reset therefore cannot race past an uncommitted durable attempt.
export async function ensureGovernor(
  tx: Prisma.TransactionClient,
  userId: string,
  clock?: () => number,
  force = false,
) {
  const governor = new RollingGovernor(redis, userId, clock);
  if (!force && (await governor.ready())) return governor;
  const now = clock?.() ?? Date.now();
  const cutoff = new Date(Math.floor(now / 60000) * 60000 - WINDOW_MS);
  const rows = await tx.$queryRaw<
    {
      at: Date;
      cost: bigint;
      domain: string;
      provider: string;
      campaign: string;
    }[]
  >`
    SELECT date_trunc('minute',COALESCE(a."transmissionStartedAt",CASE WHEN a."safetyReservedAt" IS NULL THEN a."startedAt" END)) AS at,
      sum(a."messageUnits")::bigint AS cost,
      COALESCE(NULLIF(a."senderDomain",''),lower(split_part(c.message->>'from','@',2))) AS domain,
      a."providerId" AS provider,d."campaignId" AS campaign
    FROM "DeliveryAttempt" a JOIN "Delivery" d ON d.id=a."deliveryId" JOIN "Campaign" c ON c.id=d."campaignId"
    WHERE a."userId"=${userId} AND a.state<>'NOT_STARTED'
      AND COALESCE(a."transmissionStartedAt",CASE WHEN a."safetyReservedAt" IS NULL THEN a."startedAt" END)>=${cutoff}
    GROUP BY 1,3,4,5`;
  const restored: RestoredUsage[] = rows.map((r) => ({
    at: r.at.getTime(),
    cost: Number(r.cost),
    scopes: [
      "account",
      "domain:" + r.domain,
      "provider:" + r.provider,
      "campaign:" + r.campaign,
    ],
  }));
  const tests = await tx.$queryRaw<
    { at: Date; cost: bigint; domain: string; provider: string }[]
  >`
    SELECT date_trunc('minute',t."safetyAt") AS at,count(*) AS cost,t."senderDomain" AS domain,t."providerId" AS provider
    FROM "ProviderTestDelivery" t JOIN "ProviderConnection" p ON p.id=t."providerId"
    WHERE p."userId"=${userId} AND t."safetyAt">=${cutoff} GROUP BY 1,3,4`;
  for (const t of tests)
    restored.push({
      at: t.at.getTime(),
      cost: Number(t.cost),
      scopes: ["account", "domain:" + t.domain, "provider:" + t.provider],
    });
  const reserved = await tx.deliveryAttempt.findMany({
    where: {
      userId,
      state: "RESERVED",
      transmissionStartedAt: null,
      safetyReservedAt: { gt: new Date(now - RESERVATION_MS) },
    },
    include: { delivery: { select: { campaignId: true } } },
  });
  for (const a of reserved)
    restored.push({
      at: a.safetyReservedAt!.getTime(),
      cost: a.messageUnits,
      token: a.id,
      scopes: [
        "account",
        "domain:" + a.senderDomain,
        "provider:" + a.providerId,
        "campaign:" + a.delivery.campaignId,
      ],
    });
  await governor.restore(restored);
  return governor;
}
export async function rebuildSafety(userId: string, clock?: () => number) {
  return db.$transaction(
    async (tx) => {
      await lockSafety(tx, userId);
      await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await ensureGovernor(tx, userId, clock, true);
    },
    { timeout: 60000 },
  );
}
export async function getSafetySettings(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const providers = await db.providerConnection.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, name: true, dailyBudgetOverride: true },
  });
  return {
    ...safetySettings.parse(user.safetySettings),
    pausedReason: user.safetyPausedReason,
    providers,
  };
}
export async function saveSafetySettings(userId: string, input: unknown) {
  const data = safetySettings
    .extend({
      providers: z
        .array(
          z
            .object({
              id: z.uuid(),
              dailyBudgetOverride: dailyBudget.nullable(),
            })
            .strict(),
        )
        .max(100)
        .default([]),
    })
    .parse(input);
  const { providers, ...settings } = data;
  await db.$transaction(async (tx) => {
    await lockSafety(tx, userId);
    for (const p of providers) {
      const changed = await tx.providerConnection.updateMany({
        where: { id: p.id, userId, deletedAt: null },
        data: { dailyBudgetOverride: p.dailyBudgetOverride },
      });
      if (!changed.count)
        throw new AppError(404, "PROVIDER", "Provider not found.");
    }
    await tx.user.update({
      where: { id: userId },
      data: { safetySettings: settings },
    });
    await tx.campaign.updateMany({
      where: { userId, safetyWaitUntil: { not: null } },
      data: { safetyWaitUntil: null, safetyWaitReason: null },
    });
    await tx.auditEvent.create({
      data: { userId, action: "safety.settings.updated", resourceId: userId },
    });
  });
  return getSafetySettings(userId);
}
export async function waitForSafety(
  tx: Prisma.TransactionClient,
  campaign: {
    id: string;
    userId: string;
    safetyWaitReason: string | null;
    safetyWaitUntil: Date | null;
  },
  scopes: string[],
  next: number,
  now: number,
  reason = DAILY_WAIT,
) {
  const changed =
    campaign.safetyWaitReason !== reason ||
    !campaign.safetyWaitUntil ||
    campaign.safetyWaitUntil.getTime() <= now;
  await tx.campaign.update({
    where: { id: campaign.id },
    data: {
      safetyWaitReason: reason,
      safetyWaitUntil: new Date(Math.max(now + 1000, next)),
    },
  });
  if (!changed) return;
  await tx.activityEvent.create({
    data: {
      userId: campaign.userId,
      campaignId: campaign.id,
      kind: "SAFETY_WAIT",
      message: reason,
    },
  });
  for (const kind of new Set(scopes.map((s) => s.split(":")[0]))) {
    const action = `safety.${kind}_limit_reached`;
    const recent = await tx.auditEvent.findFirst({
      where: {
        userId: campaign.userId,
        action,
        createdAt: { gt: new Date(now - 300000) },
      },
    });
    if (!recent)
      await tx.auditEvent.create({
        data: { userId: campaign.userId, action, resourceId: campaign.id },
      });
  }
}
export async function safetyCapacity(
  userId: string,
  from: string,
  campaignId?: string,
  clock?: () => number,
) {
  return db.$transaction(
    async (tx) => {
      await lockSafety(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const settings = safetySettings.parse(user.safetySettings);
      const campaign = campaignId
        ? await tx.campaign.findFirst({ where: { id: campaignId, userId } })
        : null;
      if (campaignId && !campaign)
        throw new AppError(404, "NOT_FOUND", "Campaign not found.");
      const g = await ensureGovernor(tx, userId, clock);
      const usage = await g.inspect(
        commonBudgets(
          settings,
          senderDomain(from),
          campaignId,
          campaign?.dailyBudget,
        ),
      );
      const providers = await tx.providerConnection.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, dailyBudgetOverride: true },
      });
      const providerUsage = providers.length
        ? await g.inspect(
            providers.map((p) => ({
              scope: "provider:" + p.id,
              limit: p.dailyBudgetOverride ?? settings.providerDaily,
            })),
          )
        : [];
      const available = Math.max(
        0,
        Math.min(
          ...usage
            .filter((b) => b.limit !== null)
            .map((b) => b.limit! - b.used),
        ),
      );
      return {
        usage,
        providerUsage,
        available,
        reviewScope: user.safetyPausedReason
          ? ("account" as const)
          : ("campaign" as const),
        campaignDefault: settings.campaignDaily,
        domain: senderDomain(from),
        pausedReason:
          user.safetyPausedReason ?? campaign?.safetyPausedReason ?? null,
        waitReason: campaign?.safetyWaitReason ?? null,
        nextReleaseAt: campaign?.safetyWaitUntil?.getTime() ?? null,
      };
    },
    { timeout: 60000 },
  );
}
