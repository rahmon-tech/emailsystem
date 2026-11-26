import { db, type Prisma } from "@emailsystem/db";
import { z } from "zod";
import { safetySettings, brakeDecision } from "./safety-config";
import { lockSafety } from "./safety";
import { AppError } from "./errors";
import { campaignSendingDomains, domainBounceReason } from "./safety-domain";

export async function safetyOutcomes(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string | null,
  after: Date,
) {
  // One denominator entry per campaign delivery + envelope recipient. Retries,
  // duplicate event IDs and repeated notifications cannot inflate either count.
  const [row] = await tx.$queryRaw<
    { sample: bigint; complaints: bigint; hardBounces: bigint }[]
  >`
    WITH cohort AS (
      SELECT d.id, x.email, min(a."startedAt") AS first_send
      FROM "DeliveryAttempt" a JOIN "Delivery" d ON d.id=a."deliveryId" JOIN "Campaign" c ON c.id=d."campaignId"
      CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(d.email) || COALESCE(c.message->'cc','[]') || COALESCE(c.message->'bcc','[]')) x(email)
      WHERE a."userId"=${userId} AND a.state='ACCEPTED' AND a."startedAt">=${after}
        AND (${campaignId}::text IS NULL OR c.id=${campaignId})
      GROUP BY d.id,x.email
    ), outcomes AS (
      SELECT c.id,c.email,
        bool_or(e.kind='complaint') AS complaint, bool_or(e.kind='hard_bounce') AS bounce
      FROM cohort c
      LEFT JOIN "DeliveryAttempt" a ON a."deliveryId"=c.id AND a."userId"=${userId}
      LEFT JOIN "ProviderEvent" e ON e."attemptId"=a.id AND e."providerId"=a."providerId" AND e.processed=true
        AND COALESCE(e.recipient,(SELECT d.email FROM "Delivery" d WHERE d.id=c.id))=c.email
      WHERE NOT EXISTS (SELECT 1 FROM "Suppression" s WHERE s."userId"=${userId} AND s.email=c.email AND s."createdAt"<c.first_send)
      GROUP BY c.id,c.email
    ) SELECT count(*) AS sample,count(*) FILTER(WHERE complaint) AS complaints,count(*) FILTER(WHERE bounce) AS "hardBounces" FROM outcomes`;
  return {
    sample: Number(row.sample),
    complaints: Number(row.complaints),
    hardBounces: Number(row.hardBounces),
  };
}

export async function safetyDomainOutcomes(
  tx: Prisma.TransactionClient,
  userId: string,
  domain: string,
  after: Date,
) {
  // The envelope recipient and actual attempted sending domain form one sample.
  // Use DeliveryAttempt.senderDomain rather than the campaign's first From
  // address: a campaign can legitimately rotate across selected domains.
  // Matching events only to that same domain prevents cross-domain contamination.
  const [row] = await tx.$queryRaw<
    { sample: bigint; complaints: bigint; hardBounces: bigint }[]
  >`
    WITH cohort AS (
      SELECT d.id, x.email, min(a."startedAt") AS first_send
      FROM "DeliveryAttempt" a
      JOIN "Delivery" d ON d.id=a."deliveryId"
      JOIN "Campaign" c ON c.id=d."campaignId"
      CROSS JOIN LATERAL jsonb_array_elements_text(
        jsonb_build_array(d.email) ||
        COALESCE(c.message->'cc','[]') ||
        COALESCE(c.message->'bcc','[]')
      ) x(email)
      WHERE a."userId"=${userId}
        AND a.state='ACCEPTED'
        AND a."startedAt">=${after}
        AND COALESCE(NULLIF(a."senderDomain",''),split_part(c.message->>'from','@',2))=${domain}
      GROUP BY d.id,x.email
    ), outcomes AS (
      SELECT cohort.id, cohort.email,
        bool_or(e.kind='complaint') AS complaint,
        bool_or(e.kind='hard_bounce') AS bounce
      FROM cohort
      LEFT JOIN "DeliveryAttempt" a
        ON a."deliveryId"=cohort.id AND a."userId"=${userId}
        AND COALESCE(NULLIF(a."senderDomain",''),
          (SELECT split_part(c.message->>'from','@',2)
           FROM "Delivery" d JOIN "Campaign" c ON c.id=d."campaignId"
           WHERE d.id=cohort.id))=${domain}
      LEFT JOIN "ProviderEvent" e
        ON e."attemptId"=a.id AND e."providerId"=a."providerId"
        AND e.processed=true
        AND COALESCE(e.recipient,
          (SELECT d.email FROM "Delivery" d WHERE d.id=cohort.id))=cohort.email
      WHERE NOT EXISTS (
        SELECT 1 FROM "Suppression" s
        WHERE s."userId"=${userId} AND s.email=cohort.email
          AND s."createdAt"<cohort.first_send
      )
      GROUP BY cohort.id,cohort.email
    )
    SELECT count(*) AS sample,
      count(*) FILTER (WHERE complaint) AS complaints,
      count(*) FILTER (WHERE bounce) AS "hardBounces"
    FROM outcomes`;
  return {
    sample: Number(row.sample),
    complaints: Number(row.complaints),
    hardBounces: Number(row.hardBounces),
  };
}

export async function checkExistingSafetyOutcomes(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
) {
  if (
    await tx.providerEvent.findFirst({
      where: {
        provider: { userId },
        processed: true,
        kind: { in: ["complaint", "hard_bounce"] },
        createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
      },
      select: { id: true },
    })
  )
    await evaluateSafetyBrakes(tx, userId, campaignId);
}
// Called inside the authoritative event transaction, under the account lock.
export async function evaluateSafetyBrakes(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
  now = Date.now(),
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const campaign = await tx.campaign.findUniqueOrThrow({
    where: { id: campaignId },
  });
  const settings = safetySettings.parse(user.safetySettings);
  if (settings.brakeScope === "domain") {
    for (const domain of campaignSendingDomains(campaign.message)) {
      const current = await tx.domainSafetyPause.findUnique({
        where: { userId_domain: { userId, domain } },
      });
      if (current?.pausedReason) continue;
      const since = new Date(
        Math.max(
          now - 7 * 86400000,
          current?.reviewedAt?.getTime() ?? 0,
        ),
      );
      const outcome = await safetyDomainOutcomes(tx, userId, domain, since);
      const brake = brakeDecision(settings, outcome);
      if (!brake) continue;
      const reason = domainBounceReason(domain, brake);
      await tx.domainSafetyPause.upsert({
        where: { userId_domain: { userId, domain } },
        create: { userId, domain, pausedReason: reason, pausedAt: new Date(now) },
        update: { pausedReason: reason, pausedAt: new Date(now) },
      });
      const activeCampaigns = await tx.campaign.findMany({
        where: {
          userId,
          state: { in: ["PREPARING", "QUEUED", "SENDING", "PAUSED"] },
        },
        orderBy: { id: "asc" },
        select: { id: true, state: true, message: true, safetyPausedReason: true },
      });
      for (const active of activeCampaigns) {
        if (!campaignSendingDomains(active.message).includes(domain)) continue;
        // Do not overwrite a separate safety reason if the campaign is already
        // paused; reviewing this domain must not accidentally remove that lock.
        const pausedReason = active.safetyPausedReason ?? reason;
        await tx.campaign.update({
          where: { id: active.id },
          data: {
            ...(active.state === "PREPARING" ? {} : { state: "PAUSED" }),
            safetyPausedReason: pausedReason,
            safeError: pausedReason,
            safetyWaitReason: null,
            safetyWaitUntil: null,
          },
        });
        await tx.activityEvent.create({
          data: {
            userId,
            campaignId: active.id,
            kind: "SAFETY_PAUSED",
            message: reason,
          },
        });
      }
      await tx.auditEvent.create({
        data: { userId, action: "safety.domain_auto_paused", resourceId: domain },
      });
    }
    return;
  }
  const since = (review?: Date | null) =>
    new Date(
      Math.max(
        now - 7 * 86400000,
        user.safetyReviewedAt?.getTime() ?? 0,
        review?.getTime() ?? 0,
      ),
    );
  const scopes =
    settings.brakeScope === "both"
      ? ["account", "campaign"]
      : [settings.brakeScope];
  for (const scope of scopes) {
    if (
      scope === "account"
        ? user.safetyPausedReason
        : campaign.safetyPausedReason
    )
      continue;
    const outcome = await safetyOutcomes(
      tx,
      userId,
      scope === "campaign" ? campaignId : null,
      since(scope === "campaign" ? campaign.safetyReviewedAt : null),
    );
    const brake = brakeDecision(settings, outcome);
    if (!brake) continue;
    const reason = `${brake === "complaint" ? "Complaint" : "Hard bounce"} safety threshold reached · administrator review required`;
    if (scope === "account")
      await tx.user.update({
        where: { id: userId },
        data: { safetyPausedReason: reason },
      });
    const campaigns = await tx.campaign.findMany({
      where: {
        userId,
        ...(scope === "campaign" ? { id: campaignId } : {}),
        state: { in: ["PREPARING", "QUEUED", "SENDING", "PAUSED"] },
      },
      orderBy: { id: "asc" },
      select: { id: true, state: true },
    });
    for (const c of campaigns) {
      // PREPARING completes durably; prepareCampaign observes the sticky brake.
      await tx.campaign.update({
        where: { id: c.id },
        data: {
          ...(c.state === "PREPARING" ? {} : { state: "PAUSED" }),
          safetyPausedReason: reason,
          safeError: reason,
          safetyWaitReason: null,
          safetyWaitUntil: null,
        },
      });
      await tx.activityEvent.create({
        data: {
          userId,
          campaignId: c.id,
          kind: "SAFETY_PAUSED",
          message: reason,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        userId,
        action: "safety.auto_paused",
        resourceId: scope === "account" ? userId : campaignId,
      },
    });
    if (scope === "account") break;
  }
}
export async function reviewSafety(userId: string, input: unknown) {
  const data = z
    .object({
      campaignId: z.uuid().optional(),
      domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/).optional(),
      acknowledgement: z.literal(true),
    })
    .strict()
    .refine((value) => !(value.campaignId && value.domain), {
      message: "Review either a sending domain or a campaign, not both.",
    })
    .parse(input);
  return db.$transaction(
    async (tx) => {
      await lockSafety(tx, userId);
      if (
        await tx.providerConnection.count({
          where: { userId, health: "POLICY_BLOCKED" },
        })
      )
        throw new AppError(
          409,
          "POLICY",
          "Resolve the sending-service block before completing this review.",
        );
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (data.domain) {
        if (user.safetyPausedReason)
          throw new AppError(
            409,
            "SAFETY",
            "An existing account-wide sending lock needs a separate review first.",
          );
        const paused = await tx.domainSafetyPause.findUnique({
          where: { userId_domain: { userId, domain: data.domain } },
        });
        if (!paused?.pausedReason)
          throw new AppError(
            409,
            "SAFETY",
            "This sending domain has no active bounce or complaint pause.",
          );
        const reviewedAt = new Date();
        await tx.domainSafetyPause.update({
          where: { userId_domain: { userId, domain: data.domain } },
          data: { pausedReason: null, reviewedAt },
        });
        // Clear only the reason being acknowledged. Mixed-domain campaigns
        // remain blocked if a second selected domain is still paused.
        const affected = await tx.campaign.findMany({
          where: {
            userId,
            safetyPausedReason: paused.pausedReason,
          },
          select: { id: true, message: true },
        });
        for (const campaign of affected) {
          const otherPauses = await tx.domainSafetyPause.findMany({
            where: {
              userId,
              domain: { in: campaignSendingDomains(campaign.message) },
              pausedReason: { not: null },
            },
            take: 1,
          });
          const nextReason = otherPauses[0]?.pausedReason ?? null;
          await tx.campaign.update({
            where: { id: campaign.id },
            data: {
              safetyPausedReason: nextReason,
              safetyReviewedAt: reviewedAt,
              safeError: nextReason,
            },
          });
        }
        await tx.auditEvent.create({
          data: { userId, action: "safety.domain_reviewed", resourceId: data.domain },
        });
        return { reviewed: true };
      }
      if (data.campaignId && user.safetyPausedReason)
        throw new AppError(
          409,
          "SAFETY",
          "Review the account-wide sending pause first.",
        );
      if (
        data.campaignId &&
        !(await tx.campaign.findFirst({
          where: { id: data.campaignId, userId },
        }))
      )
        throw new AppError(404, "NOT_FOUND", "Campaign not found.");
      const reviewedAt = new Date();
      if (!data.campaignId)
        await tx.user.update({
          where: { id: userId },
          data: { safetyPausedReason: null, safetyReviewedAt: reviewedAt },
        });
      await tx.campaign.updateMany({
        where: {
          userId,
          ...(data.campaignId ? { id: data.campaignId } : {}),
          safetyPausedReason: { not: null },
        },
        data: {
          safetyPausedReason: null,
          safetyReviewedAt: reviewedAt,
          safeError: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          userId,
          action: "safety.reviewed",
          resourceId: data.campaignId ?? userId,
        },
      });
      // Recording a review never resumes a campaign. Resume is a separate action.
      return { reviewed: true };
    },
    { timeout: 60000 },
  );
}
