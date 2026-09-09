import { lockSafety, safetyCapacity } from "./safety";
import { dailyBudget, messageCost } from "./safety-config";
import { db } from "@emailsystem/db";
import type { CampaignState, Prisma } from "@emailsystem/db";
import { z } from "zod";
import { normalizeEmail, renderSnapshot } from "@emailsystem/email";
import { headerText } from "@emailsystem/providers/catalog";
import type { ProviderMessage } from "@emailsystem/providers";
import { config } from "./config";
import { AppError } from "./errors";
import { json, compatible } from "./providers";
import { digest, makeSignedToken } from "./security";
import { transitionCampaign, unclaimedStates } from "./domain";
import { inspectDestinations } from "./reputation";
import {
  trackingChoice,
  createTrackedSnapshot,
  trackingSummary,
} from "./tracking";
export const messageInput = z
  .object({
    name: headerText.min(1),
    importId: z.uuid(),
    from: z.email().transform((s) => s.toLowerCase()),
    fromName: headerText.default(""),
    replyTo: z.union([z.email(), z.literal("")]).default(""),
    subject: headerText.min(1),
    preheader: z.string().max(200).default(""),
    cc: z
      .array(z.email().transform((s) => s.toLowerCase()))
      .max(5)
      .default([]),
    bcc: z
      .array(z.email().transform((s) => s.toLowerCase()))
      .max(5)
      .default([]),
    html: z.string().min(1).max(512000),
    text: z.string().max(512000).optional(),
    attachments: z
      .array(
        z.object({
          filename: z
            .string()
            .max(150)
            .regex(/^[^/\\\r\n]+$/),
          content: z
            .string()
            .max(7000000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
          contentType: z.string().regex(/^[a-z-]+\/[a-z0-9.+-]+$/i),
        }),
      )
      .max(5)
      .default([]),
    dailyBudget: dailyBudget.nullable().optional(),
    tracking: z
      .object({ enabled: z.boolean(), domainId: z.uuid().optional() })
      .strict()
      .optional(),
    scheduledAt: z.iso.datetime().optional(),
    startKey: z.uuid().optional(),
    tags: z.array(headerText.max(40)).max(10).default([]),
  })
  .strict();
export async function preflight(userId: string, input: unknown) {
  const data = messageInput.parse(input);
  const problems: string[] = [];
  if (
    data.attachments.reduce(
      (n, a) => n + Buffer.byteLength(a.content, "base64"),
      0,
    ) > 5000000
  )
    problems.push("Attachments must total at most 5 MB.");
  const list = await db.contactImport.findFirst({
    where: { id: data.importId, userId, state: "READY" },
  });
  if (!list)
    throw new AppError(
      404,
      "IMPORT",
      "Recipient import not found or not ready.",
    );
  const count = await db.importRecipient.count({
    where: { importId: list.id, userId },
  });
  if (!count) problems.push("The import has no sendable recipients.");
  const copies = [...data.cc, ...data.bcc];
  if (new Set(copies).size !== copies.length)
    problems.push("CC and BCC addresses must be unique.");
  if (
    copies.length &&
    (await db.importRecipient.count({
      where: { importId: list.id, userId, email: { in: copies } },
    }))
  )
    problems.push("CC/BCC addresses must not appear in the recipient list.");
  if (
    copies.length &&
    (await db.suppression.count({ where: { userId, email: { in: copies } } }))
  )
    problems.push("A CC/BCC address is suppressed.");
  const providers = (
    await db.providerConnection.findMany({ where: { userId, deletedAt: null } })
  ).filter((p) => compatible(p, data.from));
  if (
    providers.length &&
    providers.every(
      (p) => p.perSecond < 1 + copies.length || p.perMinute < 1 + copies.length,
    )
  )
    problems.push(
      "Raise the provider rate limits to cover one recipient plus the CC/BCC copies, or remove copies.",
    );
  if (!providers.length)
    problems.push(
      "Verify at least one provider configured with this From address.",
    );
  const safety = await safetyCapacity(userId, data.from);
  const campaignLimit =
    data.dailyBudget === undefined ? safety.campaignDefault : data.dailyBudget;
  const cost = messageCost(data);
  if (
    [...safety.usage.map((b) => b.limit), campaignLimit].some(
      (limit) => limit !== null && limit < cost,
    )
  )
    problems.push(
      "A safety budget is too small for one message and its copies. Raise it or remove copies.",
    );
  if (safety.pausedReason) problems.push(safety.pausedReason);
  const snapshot = normalizeEmail(data.html, data.preheader);
  const [reputation, tracking] = await Promise.all([
    inspectDestinations(userId, snapshot.html),
    trackingChoice(userId, data.tracking),
  ]);
  problems.push(...reputation.problems);
  if (tracking.problem) problems.push(tracking.problem);
  if (
    tracking.settings.blockUnknown &&
    reputation.links.some((r) => r.state === "REPUTATION_UNKNOWN")
  )
    problems.push(
      "Your link policy requires known reputation results. Review unknown destinations or update the policy.",
    );
  if (!snapshot.text.trim())
    problems.push("The email body is empty after safety checks.");
  const message = {
    from: data.from,
    fromName: data.fromName,
    replyTo: data.replyTo,
    subject: data.subject,
    cc: data.cc,
    bcc: data.bcc,
    html: snapshot.html,
    text: data.text?.trim() || snapshot.text,
    headers: {},
    attachments: data.attachments,
    tags: data.tags,
    snapshotHash: snapshot.hash,
    tracking: {
      enabled: tracking.enabled,
      hostname: tracking.domain?.hostname ?? null,
    },
  };
  return {
    ready: !problems.length,
    problems,
    warnings: [
      ...snapshot.warnings,
      ...reputation.warnings,
      ...(copies.length
        ? [
            `${copies.length} CC/BCC copies will be sent for every recipient and count toward provider limits.`,
          ]
        : []),
    ],
    count,
    reputation: reputation.links,
    tracking,
    safety: {
      campaignUnits: count * cost,
      availableUnits: Math.min(
        safety.available,
        campaignLimit ?? Infinity,
        safety.providerUsage
          .filter((b) => providers.some((p) => b.scope === "provider:" + p.id))
          .reduce((total, b) => total + Math.max(0, b.limit! - b.used), 0),
      ),
      campaignDaily: campaignLimit,
    },
    providers: providers.map((p) => ({ id: p.id, name: p.name })),
    message,
    previewHtml: renderSnapshot(
      snapshot.html,
      config().APP_URL + "/unsubscribe/preview",
    ),
    importStats: list.stats,
    data,
  };
}
export async function createCampaign(userId: string, input: unknown) {
  const data = messageInput.parse(input);
  const key = data.startKey ?? crypto.randomUUID();
  const previous = await db.campaign.findUnique({
    where: { userId_startKey: { userId, startKey: key } },
  });
  if (previous) return previous;
  const result = await preflight(userId, data);
  if (!result.ready)
    throw new AppError(422, "PREFLIGHT", result.problems.join(" "));
  // Unique owner + start key makes repeated browser submissions refer to one campaign.
  return db.$transaction(async (tx) => {
    const created = await tx.campaign.createMany({
      data: [
        {
          userId,
          name: result.data.name,
          state: "PREPARING",
          message: json(result.message),
          dailyBudget: result.safety.campaignDaily,
          importId: result.data.importId,
          intendedRecipientCount: result.count,
          startKey: key,
          scheduledAt: result.data.scheduledAt
            ? new Date(result.data.scheduledAt)
            : new Date(),
        },
      ],
      skipDuplicates: true,
    });
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { userId_startKey: { userId, startKey: key } },
    });
    if (!created.count) return campaign;
    const html = await createTrackedSnapshot(
      tx,
      userId,
      campaign.id,
      result.message.html,
      result.tracking.domain,
    );
    return tx.campaign.update({
      where: { id: campaign.id },
      data: {
        message: json({ ...result.message, html, snapshotHash: digest(html) }),
      },
    });
  });
}
export async function lockCampaign(
  tx: Prisma.TransactionClient,
  id: string,
  userId?: string,
) {
  if (userId)
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${id} AND "userId"=${userId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${id} FOR UPDATE`;
}
export async function prepareCampaign(id: string) {
  return db.$transaction(
    async (tx) => {
      const owner = await tx.campaign.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!owner) return;
      await lockSafety(tx, owner.userId);
      await lockCampaign(tx, id);
      const c = await tx.campaign.findUnique({ where: { id } });
      if (!c || c.preparedAt || !["PREPARING", "CANCELLING"].includes(c.state))
        return;
      const user = await tx.user.findUniqueOrThrow({ where: { id: c.userId } });
      const paused = c.safetyPausedReason ?? user.safetyPausedReason;
      const batch = await tx.importRecipient.findMany({
        where: {
          importId: c.importId,
          userId: c.userId,
          ...(c.preparationCursor ? { id: { gt: c.preparationCursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 500,
      });
      const data = batch.map((r) => {
        const token = makeSignedToken(config().SESSION_SECRET);
        return {
          userId: c.userId,
          campaignId: id,
          email: r.email,
          unsubscribeToken: token,
          unsubscribeHash: digest(token),
          state:
            c.state === "CANCELLING"
              ? ("CANCELLED" as const)
              : ("PENDING" as const),
          nextAttemptAt: c.scheduledAt,
        };
      });
      if (data.length)
        await tx.delivery.createMany({ data, skipDuplicates: true });
      const finished = batch.length < 500;
      await tx.campaign.update({
        where: { id },
        data: {
          recipientCount: { increment: batch.length },
          preparationCursor: batch.at(-1)?.id ?? c.preparationCursor,
          ...(finished
            ? {
                preparedAt: new Date(),
                state:
                  c.state === "CANCELLING"
                    ? "CANCELLED"
                    : paused
                      ? "PAUSED"
                      : "QUEUED",
                ...(paused
                  ? { safetyPausedReason: paused, safeError: paused }
                  : {}),
                ...(c.state === "CANCELLING"
                  ? { completedAt: new Date() }
                  : {}),
              }
            : {}),
        },
      });
      if (finished) {
        await tx.activityEvent.create({
          data: {
            userId: c.userId,
            campaignId: id,
            kind: "PREPARED",
            message:
              c.state === "CANCELLING"
                ? "Campaign cancelled before dispatch."
                : "Recipients prepared. Campaign is queued.",
          },
        });
        await tx.auditEvent.create({
          data: {
            userId: c.userId,
            action: "campaign.started",
            resourceId: id,
          },
        });
      }
    },
    { timeout: 20000 },
  );
}
export async function controlCampaign(
  userId: string,
  id: string,
  action: "pause" | "resume" | "cancel",
) {
  return db.$transaction(async (tx) => {
    await lockSafety(tx, userId);
    await lockCampaign(tx, id, userId);
    const c = await tx.campaign.findFirst({ where: { id, userId } });
    if (!c) throw new AppError(404, "NOT_FOUND", "Campaign not found.");
    if (action === "resume") {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.safetyPausedReason || c.safetyPausedReason)
        throw new AppError(
          409,
          "SAFETY_REVIEW",
          "Administrator safety review is required before resuming.",
        );
      if (
        await tx.providerConnection.count({
          where: { userId, health: "POLICY_BLOCKED" },
        })
      )
        throw new AppError(
          409,
          "POLICY",
          "Resolve the provider enforcement block before resuming.",
        );
    }
    let state: CampaignState;
    try {
      state = transitionCampaign(c.state, action);
    } catch {
      throw new AppError(
        409,
        "STATE",
        "This action is unavailable in the current campaign state.",
      );
    }
    if (action === "cancel")
      await tx.delivery.updateMany({
        where: { campaignId: id, userId, state: { in: unclaimedStates } },
        data: { state: "CANCELLED" },
      });
    if (
      action === "cancel" &&
      c.preparedAt &&
      !(await tx.delivery.count({
        where: { campaignId: id, state: "PROCESSING" },
      }))
    )
      state = "CANCELLED";
    const updated = await tx.campaign.update({
      where: { id },
      data: {
        state,
        ...(state === "CANCELLED" ? { completedAt: new Date() } : {}),
      },
    });
    await tx.auditEvent.create({
      data: { userId, action: `campaign.${action}`, resourceId: id },
    });
    await tx.activityEvent.create({
      data: {
        userId,
        campaignId: id,
        kind: state,
        message: `Campaign ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancellation requested"}.`,
      },
    });
    return updated;
  });
}
export async function campaignSummary(userId: string, id: string) {
  const c = await db.campaign.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      state: true,
      recipientCount: true,
      intendedRecipientCount: true,
      preparedAt: true,
      createdAt: true,
      scheduledAt: true,
      startedAt: true,
      completedAt: true,
      safeError: true,
      message: true,
      safetyPausedReason: true,
    },
  });
  if (!c) throw new AppError(404, "NOT_FOUND", "Campaign not found.");
  const [counts, providers, acceptedCount] = await Promise.all([
    db.delivery.groupBy({
      by: ["state"],
      where: { campaignId: id, userId },
      _count: true,
    }),
    db.deliveryAttempt.groupBy({
      by: ["providerId", "state"],
      where: {
        userId,
        delivery: { campaignId: id },
        state: { notIn: ["NOT_STARTED", "RESERVED"] },
      },
      _count: true,
    }),
    db.delivery.count({
      where: { campaignId: id, userId, acceptedAt: { not: null } },
    }),
  ]);
  const safety = await safetyCapacity(
    userId,
    (c.message as { from: string }).from,
    id,
  );
  const summary = { ...c, message: undefined };
  return {
    ...summary,
    tracking: {
      ...(await trackingSummary(userId, id)),
      enabled:
        (c.message as { tracking?: { enabled: boolean } }).tracking?.enabled ??
        false,
    },
    safety,
    acceptedCount,
    counts: Object.fromEntries(counts.map((r) => [r.state, r._count])),
    providers,
  };
}
export function deliveryMessage(
  snapshot: unknown,
  email: string,
  token: string,
): ProviderMessage {
  const m = snapshot as Omit<ProviderMessage, "to">;
  const url = config().APP_URL + "/unsubscribe/" + token;
  return {
    ...m,
    to: email,
    html: renderSnapshot(m.html, url),
    text: m.text + "\n\nUnsubscribe: " + url,
    headers: {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
