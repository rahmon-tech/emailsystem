import { lockSafety, safetyCapacity } from "./safety";
import { dailyBudget, messageCost } from "./safety-config";
import { db } from "@emailsystem/db";
import type { CampaignState, Prisma } from "@emailsystem/db";
import { z } from "zod";
import { normalizeEmail, renderSnapshot } from "@emailsystem/email";
import { headerText } from "@emailsystem/providers/catalog";
import { supportsInlineAttachmentTransport } from "@emailsystem/providers/capabilities";
import type { ProviderMessage } from "@emailsystem/providers";
import { config } from "./config";
import { AppError } from "./errors";
import { json } from "./providers";
import { digest, makeSignedToken } from "./security";
import { transitionCampaign, unclaimedStates } from "./domain";
import { inspectDestinations } from "./reputation";
import {
  trackingChoice,
  createTrackedSnapshot,
  trackingSummary,
} from "./tracking";
import { resolveSender, resolveSenderDomain } from "./senders";
import { absoluteAppUrl } from "./server-paths";
import { validateExperimentCampaignScope } from "./experiments";

const contentIdInput = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,126}$/,
    "Use a safe Content-ID of at most 127 characters.",
  );

const attachmentInput = z
  .object({
    filename: z
      .string()
      .max(150)
      .regex(/^[^/\\\r\n]+$/),
    content: z
      .string()
      .max(7000000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    contentType: z.string().regex(/^[a-z-]+\/[a-z0-9.+-]+$/i),
    disposition: z.enum(["attachment", "inline"]).default("attachment"),
    contentId: contentIdInput.optional(),
  })
  .strict()
  .superRefine((attachment, ctx) => {
    if (attachment.disposition === "inline" && !attachment.contentId)
      ctx.addIssue({
        code: "custom",
        path: ["contentId"],
        message: "Inline attachments require a Content-ID.",
      });
    if (attachment.disposition === "attachment" && attachment.contentId)
      ctx.addIssue({
        code: "custom",
        path: ["contentId"],
        message: "Ordinary attachments cannot set a Content-ID.",
      });
  });

const attachmentsInput = z
  .array(attachmentInput)
  .max(5)
  .superRefine((attachments, ctx) => {
    const seen = new Set<string>();
    attachments.forEach((attachment, index) => {
      if (attachment.disposition !== "inline" || !attachment.contentId) return;
      if (seen.has(attachment.contentId))
        ctx.addIssue({
          code: "custom",
          path: [index, "contentId"],
          message: "Inline attachment Content-IDs must be unique.",
        });
      seen.add(attachment.contentId);
    });
  })
  .default([]);

function cidReferences(html: string) {
  return new Set(
    [...html.matchAll(/\bcid:([A-Za-z0-9][A-Za-z0-9._@-]{0,126})/gi)].map(
      (match) => match[1],
    ),
  );
}

export const messageInput = z
  .object({
    name: headerText.min(1),
    importId: z.uuid(),
    senderDomainId: z.uuid().optional(),
    senderIdentityId: z.uuid().optional(),
    experimentRunId: z.uuid().optional(),
    from: z
      .email()
      .transform((s) => s.toLowerCase())
      .optional(),
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
    attachments: attachmentsInput,
    dailyBudget: dailyBudget.nullable().optional(),
    tracking: z.object({ enabled: z.boolean() }).strict().optional(),
    scheduledAt: z.iso.datetime().optional(),
    startKey: z.uuid().optional(),
    tags: z.array(headerText.max(40)).max(10).default([]),
  })
  .strict()
  .refine(
    (value) => value.senderDomainId || value.senderIdentityId || value.from,
    {
      message: "Choose a verified sending domain.",
      path: ["senderDomainId"],
    },
  );
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
  const inlineAttachments = data.attachments.filter(
    (attachment) => attachment.disposition === "inline",
  );
  const needsInlineTransport = inlineAttachments.length > 0;
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
  const senderSelection = data.senderDomainId
    ? await resolveSenderDomain(userId, data.senderDomainId)
    : await resolveSender(userId, {
        senderIdentityId: data.senderIdentityId,
        from: data.from,
      });
  const sender = senderSelection.sender;
  const poolSenders =
    "senders" in senderSelection ? senderSelection.senders : [sender];
  const providerPool =
    data.experimentRunId && data.senderDomainId
      ? (
          await resolveSender(userId, {
            senderIdentityId: sender.id,
          })
        ).providers
      : senderSelection.providers;
  const providers = needsInlineTransport
    ? providerPool.filter((provider) =>
        supportsInlineAttachmentTransport(provider),
      )
    : providerPool;
  if (!providers.length)
    problems.push(
      needsInlineTransport
        ? "Verify this sender with at least one healthy provider transport that supports inline CID images."
        : "Verify this sender with at least one healthy broadcast provider.",
    );
  const experiment = data.experimentRunId
    ? await db.$transaction((tx) =>
        validateExperimentCampaignScope(tx, {
          userId,
          runId: data.experimentRunId!,
          senderIdentityId: sender.id,
          importId: list.id,
          eligibleProviderIds: providers.map((provider) => provider.id),
          copyRecipients: copies,
        }),
      )
    : null;
  const effectiveProviders = experiment
    ? providers.filter((provider) => experiment.providerIds.includes(provider.id))
    : providers;
  if (
    effectiveProviders.length &&
    effectiveProviders.every(
      (p) => p.perSecond < 1 + copies.length || p.perMinute < 1 + copies.length,
    )
  )
    problems.push(
      "Raise the provider rate limits to cover one recipient plus the CC/BCC copies, or remove copies.",
    );
  const safety = await safetyCapacity(userId, sender.email);
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
  const referencedCids = cidReferences(snapshot.html);
  const inlineIds = new Set(
    inlineAttachments
      .map((attachment) => attachment.contentId)
      .filter((contentId): contentId is string => !!contentId),
  );
  for (const contentId of referencedCids)
    if (!inlineIds.has(contentId))
      problems.push(`Inline image cid:${contentId} has no matching attachment.`);
  for (const contentId of inlineIds)
    if (!referencedCids.has(contentId))
      problems.push(`Inline attachment ${contentId} is not referenced by the email HTML.`);
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
  if (!(data.text?.trim() || snapshot.text.trim()))
    problems.push("The email body is empty after safety checks.");
  const message = {
    from: sender.email,
    fromName: sender.displayName,
    replyTo: sender.replyTo,
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
      appUrl: tracking.enabled ? config().APP_URL : null,
    },
    senderPool: data.senderDomainId
      ? {
          domainId: sender.authorizedDomain.id,
          enabled: poolSenders.length > 1 && !data.experimentRunId,
          aliasCount: poolSenders.length,
        }
      : undefined,
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
      ...(data.senderDomainId && poolSenders.length > 1 && !data.experimentRunId
        ? [
            `${poolSenders.length} enabled verified aliases are available on this domain. Deliveries are distributed consistently across the alias pool; provider limits are unchanged.`,
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
          .filter((b) =>
            effectiveProviders.some((p) => b.scope === "provider:" + p.id),
          )
          .reduce(
            (total, b) =>
              b.limit === null
                ? Infinity
                : total + Math.max(0, b.limit - b.used),
            0,
          ),
        safety.providerMonthlyUsage
          .filter((b) =>
            effectiveProviders.some(
              (p) => b.scope === "provider-month:" + p.id,
            ),
          )
          .reduce(
            (total, b) =>
              b.limit === null
                ? Infinity
                : total + Math.max(0, b.limit - b.used),
            0,
          ),
      ),
      campaignDaily: campaignLimit,
    },
    providers: effectiveProviders.map((p) => ({ id: p.id, name: p.name })),
    sender: {
      id: sender.id,
      domainId: sender.authorizedDomain.id,
      email: sender.email,
      domain: sender.authorizedDomain.domain,
      aliasCount: poolSenders.length,
      eligibleProviderCount: effectiveProviders.length,
    },
    experiment,
    message,
    previewHtml: renderSnapshot(
      snapshot.html,
      absoluteAppUrl("/unsubscribe/preview"),
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
    if (result.data.experimentRunId)
      await validateExperimentCampaignScope(tx, {
        userId,
        runId: result.data.experimentRunId,
        senderIdentityId: result.sender.id,
        importId: result.data.importId,
        eligibleProviderIds: result.providers.map((provider) => provider.id),
        copyRecipients: [...result.data.cc, ...result.data.bcc],
      });
    const created = await tx.campaign.createMany({
      data: [
        {
          userId,
          senderIdentityId: result.sender.id,
          experimentRunId: result.data.experimentRunId ?? null,
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
      result.tracking.enabled,
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
      if (c.experimentRunId) {
        const run = await tx.experimentRun.findFirst({
          where: { id: c.experimentRunId, userId },
          select: { state: true, startsAt: true, expiresAt: true },
        });
        const now = new Date();
        if (
          user.experimentKillSwitchAt ||
          !run ||
          run.state !== "RUNNING" ||
          (run.startsAt && now < run.startsAt) ||
          !run.expiresAt ||
          now >= run.expiresAt
        )
          throw new AppError(
            409,
            "EXPERIMENT_STATE",
            "The bound experiment run must be active before this campaign can resume.",
          );
      }
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
    if (action === "cancel" && c.experimentRunId)
      await tx.experimentRun.updateMany({
        where: {
          id: c.experimentRunId,
          userId,
          state: { in: ["READY", "RUNNING"] },
        },
        data: {
          state: "STOPPED",
          stoppedAt: new Date(),
          stopReason: "Bound campaign was cancelled by the operator.",
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
      experimentRunId: true,
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
  const url = absoluteAppUrl("/unsubscribe/" + token);
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