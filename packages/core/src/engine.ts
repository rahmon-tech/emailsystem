import { randomUUID } from "node:crypto";
import { db } from "@emailsystem/db";
import { send } from "@emailsystem/providers";
import type { SendResult, ConnectionInput } from "@emailsystem/providers";
import { compatible, unlocked } from "./providers";
import { acquireProvider, releaseProvider, rateGroup } from "./dispatcher";
import { lockCampaign, deliveryMessage } from "./campaigns";
import { retryDecision, unclaimedStates } from "./domain";
import { maskEmail } from "./security";
import { log } from "./errors";
export async function processDelivery(
  id: string,
  sendMessage: typeof send = send,
) {
  const initial = await db.delivery.findUnique({
    where: { id },
    include: { campaign: true },
  });
  if (
    !initial ||
    !unclaimedStates.includes(initial.state) ||
    initial.nextAttemptAt > new Date() ||
    !["QUEUED", "SENDING"].includes(initial.campaign.state) ||
    !initial.campaign.preparedAt
  )
    return;
  const snapshot = initial.campaign.message as unknown as {
    from: string;
    cc: string[];
    bcc: string[];
  };
  const all = await db.providerConnection.findMany({
    where: { userId: initial.userId, deletedAt: null },
  });
  if (all.some((p) => p.health === "POLICY_BLOCKED")) return;
  const eligible = all.filter((p) => compatible(p, snapshot.from));
  const cost = 1 + snapshot.cc.length + snapshot.bcc.length;
  const candidates = eligible.map((p) => ({
    id: p.id,
    weight: p.weight,
    perSecond: p.perSecond,
    perMinute: p.perMinute,
    concurrency: p.concurrency,
    cost,
    group: rateGroup(
      p.userId,
      p.type,
      snapshot.from,
      (p.settings as ConnectionInput["settings"]).region,
    ),
  }));
  const attemptId = randomUUID();
  const chosen = await acquireProvider(initial.userId, candidates, attemptId);
  if (!chosen) {
    await db.delivery.updateMany({
      where: { id, state: { in: unclaimedStates } },
      data: { nextAttemptAt: new Date(Date.now() + 5000) },
    });
    return;
  }
  const provider = eligible.find((p) => p.id === chosen)!;
  const candidate = candidates.find((p) => p.id === chosen)!;
  try {
    const claimed = await db.$transaction(async (tx) => {
      await lockCampaign(tx, initial.campaignId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.userId + ":" + initial.email},0))::text`;
      const c = await tx.campaign.findUnique({
        where: { id: initial.campaignId },
      });
      if (!c || !["QUEUED", "SENDING"].includes(c.state)) return false;
      const d = await tx.delivery.findUnique({ where: { id } });
      if (
        !d ||
        !unclaimedStates.includes(d.state) ||
        d.nextAttemptAt > new Date()
      )
        return false;
      const current = await tx.providerConnection.findFirst({
        where: {
          id: chosen,
          userId: initial.userId,
          revision: provider.revision,
          enabled: true,
          health: "HEALTHY",
          deletedAt: null,
        },
      });
      if (!current) return false;
      if (
        await tx.providerConnection.count({
          where: { userId: initial.userId, health: "POLICY_BLOCKED" },
        })
      )
        return false;
      if (
        await tx.suppression.count({
          where: {
            userId: initial.userId,
            email: { in: [initial.email, ...snapshot.cc, ...snapshot.bcc] },
          },
        })
      ) {
        await tx.delivery.update({
          where: { id },
          data: { state: "SUPPRESSED" },
        });
        await tx.activityEvent.create({
          data: {
            userId: initial.userId,
            campaignId: c.id,
            deliveryId: id,
            maskedEmail: maskEmail(initial.email),
            kind: "SUPPRESSED",
            message: "Recipient or audit-copy address is suppressed.",
          },
        });
        return false;
      }
      const changed = await tx.delivery.updateMany({
        where: { id, state: { in: unclaimedStates } },
        data: {
          state: "PROCESSING",
          claimId: attemptId,
          claimedAt: new Date(),
          attemptCount: { increment: 1 },
          safeError: null,
        },
      });
      if (!changed.count) return false;
      await tx.deliveryAttempt.create({
        data: {
          id: attemptId,
          deliveryId: id,
          userId: initial.userId,
          providerId: chosen,
          providerRevision: provider.revision,
          idempotencyKey: attemptId,
        },
      });
      await tx.campaign.update({
        where: { id: c.id },
        data: { state: "SENDING", startedAt: c.startedAt ?? new Date() },
      });
      return true;
    });
    if (!claimed) return;
    let outcome: SendResult;
    try {
      outcome = await sendMessage(
        unlocked(provider),
        deliveryMessage(
          initial.campaign.message,
          initial.email,
          initial.unsubscribeToken,
        ),
        { attemptId, idempotencyKey: attemptId },
      );
    } catch {
      outcome = {
        status: "unknown",
        error: {
          category: "unknown",
          message: "Send outcome requires reconciliation.",
        },
      };
    }
    await db.$transaction(async (tx) => {
      await lockCampaign(tx, initial.campaignId);
      const d = await tx.delivery.findUniqueOrThrow({ where: { id } });
      const pending =
        ["PROCESSING", "UNKNOWN"].includes(d.state) && d.claimId === attemptId;
      if (outcome.status === "accepted") {
        await tx.deliveryAttempt.update({
          where: { id: attemptId },
          data: {
            state: "ACCEPTED",
            providerMessageId: outcome.providerMessageId,
            finishedAt: new Date(),
          },
        });
        if (pending)
          await tx.delivery.update({
            where: { id },
            data: {
              state: "PROVIDER_ACCEPTED",
              acceptedAt: new Date(),
              safeError: null,
            },
          });
      } else {
        const proof = await tx.deliveryAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        });
        if (proof.state === "ACCEPTED") return;
        const decision = retryDecision(outcome.error.category, d.attemptCount);
        const state =
          decision === "reconcile"
            ? "UNKNOWN"
            : typeof decision === "number"
              ? "DEFERRED"
              : "FAILED";
        await tx.deliveryAttempt.update({
          where: { id: attemptId },
          data: {
            state: outcome.status === "unknown" ? "UNKNOWN" : "REJECTED",
            category: outcome.error.category,
            safeError: outcome.error.message,
            finishedAt: new Date(),
          },
        });
        if (pending)
          await tx.delivery.update({
            where: { id },
            data: {
              state,
              safeError: outcome.error.message,
              ...(typeof decision === "number"
                ? {
                    nextAttemptAt: new Date(
                      Date.now() +
                        Math.max(decision, outcome.error.retryAfterMs ?? 0),
                    ),
                  }
                : {}),
            },
          });
        if (decision === "block") {
          await tx.providerConnection.updateMany({
            where: { id: chosen, revision: provider.revision },
            data: { health: "POLICY_BLOCKED", enabled: false },
          });
          await tx.campaign.updateMany({
            where: {
              id: initial.campaignId,
              state: { in: ["QUEUED", "SENDING"] },
            },
            data: {
              state: "PAUSED",
              safeError:
                "Provider enforcement reported. Review the provider account before resuming.",
            },
          });
        } else if (
          ["authentication", "authorization", "sender_configuration"].includes(
            outcome.error.category,
          )
        )
          await tx.providerConnection.updateMany({
            where: { id: chosen, revision: provider.revision },
            data: {
              health:
                outcome.error.category === "authentication"
                  ? "AUTH_ERROR"
                  : outcome.error.category === "authorization"
                    ? "MISSING_PERMISSION"
                    : "SENDER_UNVERIFIED",
              enabled: false,
            },
          });
        else if (["temporary", "rate_limit"].includes(outcome.error.category))
          await tx.providerConnection.updateMany({
            where: { id: chosen, revision: provider.revision },
            data: {
              cooldownUntil: new Date(
                Date.now() + Math.max(30000, outcome.error.retryAfterMs ?? 0),
              ),
            },
          });
      }
      await tx.activityEvent.create({
        data: {
          userId: initial.userId,
          campaignId: initial.campaignId,
          deliveryId: id,
          providerName: provider.name,
          maskedEmail: maskEmail(initial.email),
          kind:
            outcome.status === "accepted"
              ? "PROVIDER_ACCEPTED"
              : outcome.status === "unknown"
                ? "UNKNOWN"
                : outcome.error.category.toUpperCase(),
          message:
            outcome.status === "accepted"
              ? "Provider accepted the message."
              : outcome.error.message,
        },
      });
    });
    log("delivery.attempt.completed", {
      campaignId: initial.campaignId,
      deliveryId: id,
      attemptId,
      providerConnectionId: chosen,
      status: outcome.status,
    });
  } finally {
    await releaseProvider(initial.userId, candidate, attemptId);
  }
}
export async function recoverStalled() {
  const cutoff = new Date(Date.now() - 180000);
  const stale = await db.delivery.findMany({
    where: { state: "PROCESSING", claimedAt: { lt: cutoff } },
    take: 100,
  });
  for (const d of stale)
    await db.$transaction(async (tx) => {
      await lockCampaign(tx, d.campaignId);
      const n = await tx.delivery.updateMany({
        where: {
          id: d.id,
          state: "PROCESSING",
          claimId: d.claimId,
          claimedAt: { lt: cutoff },
        },
        data: {
          state: "UNKNOWN",
          safeError:
            "Worker stopped during sending. Reconciliation is required before any retry.",
        },
      });
      if (n.count) {
        await tx.deliveryAttempt.updateMany({
          where: { id: d.claimId ?? "", state: "PROCESSING" },
          data: {
            state: "UNKNOWN",
            category: "unknown",
            finishedAt: new Date(),
          },
        });
        await tx.activityEvent.create({
          data: {
            userId: d.userId,
            campaignId: d.campaignId,
            deliveryId: d.id,
            maskedEmail: maskEmail(d.email),
            kind: "UNKNOWN",
            message: "Interrupted attempt stopped for reconciliation.",
          },
        });
      }
    });
}
export async function finishCampaigns() {
  const campaigns = await db.campaign.findMany({
    where: {
      state: { in: ["SENDING", "QUEUED", "CANCELLING"] },
      preparedAt: { not: null },
    },
    take: 100,
  });
  for (const c of campaigns)
    await db.$transaction(async (tx) => {
      await lockCampaign(tx, c.id);
      const current = await tx.campaign.findUniqueOrThrow({
        where: { id: c.id },
      });
      if (!["SENDING", "QUEUED", "CANCELLING"].includes(current.state)) return;
      if (
        await tx.delivery.count({
          where: {
            campaignId: c.id,
            state: { in: [...unclaimedStates, "PROCESSING"] },
          },
        })
      )
        return;
      const errors = await tx.delivery.count({
        where: {
          campaignId: c.id,
          state: {
            in: [
              "FAILED",
              "UNKNOWN",
              "HARD_BOUNCED",
              "COMPLAINED",
              "SOFT_BOUNCED",
            ],
          },
        },
      });
      await tx.campaign.update({
        where: { id: c.id },
        data: {
          state:
            current.state === "CANCELLING"
              ? "CANCELLED"
              : errors
                ? "COMPLETED_WITH_ERRORS"
                : "COMPLETED",
          completedAt: new Date(),
        },
      });
    });
}
