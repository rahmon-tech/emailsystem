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

export function monthWindowUtc(now = Date.now()) {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { start, next };
}

export async function sharedMonthlyUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  domains: string[] = [],
  clock?: () => number,
) {
  const now = clock?.() ?? Date.now();
  const { start } = monthWindowUtc(now);
  const monthStart = new Date(start);
  const reservationCutoff = new Date(Math.max(start, now - RESERVATION_MS));
  const scopedDomains = [...new Set(domains.map((domain) => domain.toLowerCase()))];

  const [transmitted, reserved, tests] = await Promise.all([
    tx.deliveryAttempt.groupBy({
      by: ["senderDomain"],
      where: {
        userId,
        transmissionStartedAt: { gte: monthStart },
      },
      _sum: { messageUnits: true },
    }),
    tx.deliveryAttempt.groupBy({
      by: ["senderDomain"],
      where: {
        userId,
        state: "RESERVED",
        transmissionStartedAt: null,
        safetyReservedAt: { gte: reservationCutoff },
      },
      _sum: { messageUnits: true },
    }),
    tx.providerTestDelivery.groupBy({
      by: ["senderDomain"],
      where: {
        provider: { userId },
        safetyAt: { gte: monthStart },
      },
      _count: { _all: true },
    }),
  ]);

  const byDomain = new Map<string, number>();
  let account = 0;
  const add = (domain: string, cost: number) => {
    const normalized = domain.toLowerCase();
    account += cost;
    if (!scopedDomains.length || scopedDomains.includes(normalized))
      byDomain.set(normalized, (byDomain.get(normalized) ?? 0) + cost);
  };
  for (const row of transmitted)
    add(row.senderDomain, row._sum.messageUnits ?? 0);
  for (const row of reserved)
    add(row.senderDomain, row._sum.messageUnits ?? 0);
  for (const row of tests) add(row.senderDomain, row._count._all);
  for (const domain of scopedDomains)
    if (!byDomain.has(domain)) byDomain.set(domain, 0);
  return { account, byDomain };
}

export async function providerMonthlyUsage(
  tx: Prisma.TransactionClient,
  userId: string,
  providerIds: string[],
  clock?: () => number,
) {
  const ids = [...new Set(providerIds)];
  if (!ids.length) return new Map<string, number>();
  const now = clock?.() ?? Date.now();
  const { start } = monthWindowUtc(now);
  const monthStart = new Date(start);
  const reservationCutoff = new Date(Math.max(start, now - RESERVATION_MS));

  const [transmitted, reserved, tests] = await Promise.all([
    tx.deliveryAttempt.groupBy({
      by: ["providerId"],
      where: {
        userId,
        providerId: { in: ids },
        transmissionStartedAt: { gte: monthStart },
      },
      _sum: { messageUnits: true },
    }),
    tx.deliveryAttempt.groupBy({
      by: ["providerId"],
      where: {
        userId,
        providerId: { in: ids },
        state: "RESERVED",
        transmissionStartedAt: null,
        safetyReservedAt: { gte: reservationCutoff },
      },
      _sum: { messageUnits: true },
    }),
    tx.providerTestDelivery.groupBy({
      by: ["providerId"],
      where: {
        providerId: { in: ids },
        provider: { userId },
        safetyAt: { gte: monthStart },
      },
      _count: { _all: true },
    }),
  ]);

  const usage = new Map(ids.map((id) => [id, 0]));
  for (const row of transmitted)
    usage.set(row.providerId, (usage.get(row.providerId) ?? 0) + (row._sum.messageUnits ?? 0));
  for (const row of reserved)
    usage.set(row.providerId, (usage.get(row.providerId) ?? 0) + (row._sum.messageUnits ?? 0));
  for (const row of tests)
    usage.set(row.providerId, (usage.get(row.providerId) ?? 0) + row._count._all);
  return usage;
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
    select: {
      id: true,
      name: true,
      dailyBudgetOverride: true,
      monthlyBudgetOverride: true,
    },
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
        select: {
      id: true,
      dailyBudgetOverride: true,
      monthlyBudgetOverride: true,
    },
      });
      const providerUsage = providers.length
        ? await g.inspect(
            providers.map((p) => ({
              scope: "provider:" + p.id,
              limit: p.dailyBudgetOverride ?? settings.providerDaily,
            })),
          )
        : [];
      const domain = senderDomain(from);
      const sharedMonthly = await sharedMonthlyUsage(
        tx,
        userId,
        [domain],
        clock,
      );
      const { next: nextMonthStart } = monthWindowUtc(clock?.() ?? Date.now());
      const monthlyUsage = [
        {
          scope: "account-month",
          used: sharedMonthly.account,
          limit: settings.accountMonthly,
          nextReleaseAt:
            settings.accountMonthly === null ? null : nextMonthStart,
        },
        {
          scope: "domain-month:" + domain,
          used: sharedMonthly.byDomain.get(domain) ?? 0,
          limit: settings.domainMonthly,
          nextReleaseAt:
            settings.domainMonthly === null ? null : nextMonthStart,
        },
      ];
      const monthly = await providerMonthlyUsage(
        tx,
        userId,
        providers.map((provider) => provider.id),
        clock,
      );
      const providerMonthlyUsageRows = providers.map((provider) => ({
        scope: "provider-month:" + provider.id,
        used: monthly.get(provider.id) ?? 0,
        limit: provider.monthlyBudgetOverride,
        nextReleaseAt: provider.monthlyBudgetOverride === null ? null : nextMonthStart,
      }));
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
        monthlyUsage,
        providerMonthlyUsage: providerMonthlyUsageRows,
        available,
        reviewScope: user.safetyPausedReason
          ? ("account" as const)
          : ("campaign" as const),
        campaignDefault: settings.campaignDaily,
        domain,
        pausedReason:
          user.safetyPausedReason ?? campaign?.safetyPausedReason ?? null,
        waitReason: campaign?.safetyWaitReason ?? null,
        nextReleaseAt: campaign?.safetyWaitUntil?.getTime() ?? null,
      };
    },
    { timeout: 60000 },
  );
}

export async function wakeSafetyWaiters(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.campaign.updateMany({
    where: { userId, safetyWaitReason: DAILY_WAIT },
    data: { safetyWaitUntil: null, safetyWaitReason: null },
  });
}
