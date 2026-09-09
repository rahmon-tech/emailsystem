import { checkExistingSafetyOutcomes } from "./safety-brakes";
import { randomUUID } from "node:crypto";
import { db } from "@emailsystem/db";
import { send } from "@emailsystem/providers";
import type { SendResult, ConnectionInput } from "@emailsystem/providers";
import { unlocked } from "./providers";
import { acquireProvider, releaseProvider, rateGroup } from "./dispatcher";
import { lockCampaign, deliveryMessage } from "./campaigns";
import { retryDecision, unclaimedStates } from "./domain";
import { maskEmail } from "./security";
import { log } from "./errors";
import {
  lockSafety,
  ensureGovernor,
  commonBudgets,
  senderDomain,
  waitForSafety,
  wakeSafetyWaiters,
} from "./safety";
import { safetySettings, messageCost } from "./safety-config";
import type { Candidate } from "./dispatcher";
import {
  eligibleProvidersForSenderId,
  providerStillAuthorized,
} from "./senders";
export async function processDelivery(
  id: string,
  sendMessage: typeof send = send,
  clock?: () => number,
) {
  const now = () => clock?.() ?? Date.now();
  const initial = await db.delivery.findUnique({
    where: { id },
    include: { campaign: true },
  });
  if (
    !initial ||
    !unclaimedStates.includes(initial.state) ||
    initial.nextAttemptAt.getTime() > now() ||
    !["QUEUED", "SENDING"].includes(initial.campaign.state) ||
    !initial.campaign.preparedAt ||
    (initial.campaign.safetyWaitUntil &&
      initial.campaign.safetyWaitUntil.getTime() > now())
  )
    return;
  const snapshot = initial.campaign.message as unknown as {
    from: string;
    cc: string[];
    bcc: string[];
  };
  const senderIdentityId = initial.campaign.senderIdentityId;
  if (!senderIdentityId) return;
  const cost = messageCost(snapshot),
    domain = senderDomain(snapshot.from),
    attemptId = randomUUID();
  let provider:
    | Awaited<ReturnType<typeof db.providerConnection.findFirstOrThrow>>
    | undefined;
  let candidate: Candidate | undefined;
  let quotaPeers: string[] = [];
  let transmitted = false;
  let permitAt = 0;
  try {
    const claimed = await db.$transaction(
      async (tx) => {
        await lockSafety(tx, initial.userId);
        await lockCampaign(tx, initial.campaignId);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.userId + ":" + initial.email},0))::text`;
        const c = await tx.campaign.findUnique({
          where: { id: initial.campaignId },
        });
        const d = await tx.delivery.findUnique({ where: { id } });
        const user = await tx.user.findUniqueOrThrow({
          where: { id: initial.userId },
        });
        if (
          !c ||
          !d ||
          !["QUEUED", "SENDING"].includes(c.state) ||
          user.safetyPausedReason ||
          c.safetyPausedReason ||
          !unclaimedStates.includes(d.state) ||
          d.nextAttemptAt.getTime() > now() ||
          (c.safetyWaitUntil && c.safetyWaitUntil.getTime() > now())
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
        const all = await tx.providerConnection.findMany({
          where: { userId: initial.userId, deletedAt: null },
        });
        if (all.some((p) => p.health === "POLICY_BLOCKED")) {
          await tx.campaign.update({
            where: { id: c.id },
            data: {
              state: "PAUSED",
              safeError:
                "Provider enforcement reported. Review the blocked connection before resuming.",
            },
          });
          return false;
        }
        const authorized = await eligibleProvidersForSenderId(
          tx,
          initial.userId,
          senderIdentityId,
        );
        const eligible = authorized.filter(
          (p) => p.quotaRemaining === null || p.quotaRemaining >= cost,
        );
        if (!eligible.length) {
          await waitForSafety(
            tx,
            c,
            [],
            now() + 60000,
            now(),
            "No healthy eligible provider · review connections, cooldowns and provider quota",
          );
          return false;
        }
        const settings = safetySettings.parse(user.safetySettings);
        const governor = await ensureGovernor(tx, initial.userId, clock);
        const common = commonBudgets(settings, domain, c.id, c.dailyBudget);
        // The governor filters only budget eligibility; the existing dispatcher still chooses.
        const usage = await governor.inspect(
          [
            ...common,
            ...eligible.map((p) => ({
              scope: "provider:" + p.id,
              limit: p.dailyBudgetOverride ?? settings.providerDaily,
            })),
          ],
          cost,
        );
        const commonBlocked = usage.filter(
          (b) =>
            !b.scope.startsWith("provider:") &&
            b.limit !== null &&
            b.used + cost > b.limit,
        );
        const available = eligible.filter((p) => {
          const b = usage.find((b) => b.scope === "provider:" + p.id)!;
          return b.used + cost <= b.limit!;
        });
        if (commonBlocked.length || !available.length) {
          const blocked = commonBlocked.length
            ? commonBlocked
            : usage.filter((b) => b.scope.startsWith("provider:"));
          await waitForSafety(
            tx,
            c,
            blocked.map((b) => b.scope),
            Math.max(
              now() + 60000,
              ...(commonBlocked.length
                ? blocked.map((b) => b.nextReleaseAt ?? now() + 60000)
                : [
                    Math.min(
                      ...blocked.map((b) => b.nextReleaseAt ?? now() + 60000),
                    ),
                  ]),
            ),
            now(),
          );
          return false;
        }
        const candidates = available.map((p) => ({
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
        // Keep grouped limits from every eligible peer, including budget-exhausted peers.
        const ratePeers = eligible.map((p) => ({
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
        permitAt = Date.now();
        const chosen = await acquireProvider(
          initial.userId,
          candidates,
          attemptId,
          ratePeers,
        );
        if (!chosen) return false;
        provider = eligible.find((p) => p.id === chosen)!;
        candidate = candidates.find((p) => p.id === chosen)!;
        const reservation = await governor.reserve(
          attemptId,
          [
            ...common,
            {
              scope: "provider:" + chosen,
              limit: provider.dailyBudgetOverride ?? settings.providerDaily,
            },
          ],
          cost,
        );
        if (!reservation.allowed) {
          await waitForSafety(
            tx,
            c,
            reservation.blocked,
            reservation.nextReleaseAt!,
            now(),
          );
          return false;
        }
        quotaPeers = all
          .filter(
            (p) =>
              rateGroup(
                p.userId,
                p.type,
                snapshot.from,
                (p.settings as ConnectionInput["settings"]).region,
              ) === candidate!.group,
          )
          .map((p) => p.id);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.userId + ":quota:" + candidate.group},0))::text`;
        if (
          await tx.providerConnection.count({
            where: { id: { in: quotaPeers }, quotaRemaining: { lt: cost } },
          })
        )
          return false;
        await tx.delivery.update({
          where: { id },
          data: {
            state: "PROCESSING",
            claimId: attemptId,
            claimedAt: new Date(now()),
            attemptCount: { increment: 1 },
            safeError: null,
          },
        });
        await tx.providerConnection.updateMany({
          where: { id: { in: quotaPeers }, quotaRemaining: { not: null } },
          data: { quotaRemaining: { decrement: cost } },
        });
        await tx.deliveryAttempt.create({
          data: {
            id: attemptId,
            deliveryId: id,
            userId: initial.userId,
            providerId: chosen,
            providerRevision: provider.revision,
            idempotencyKey: attemptId,
            state: "RESERVED",
            startedAt: new Date(now()),
            safetyReservedAt: new Date(now()),
            messageUnits: cost,
            senderDomain: domain,
          },
        });
        await tx.campaign.update({
          where: { id: c.id },
          data: {
            state: "SENDING",
            startedAt: c.startedAt ?? new Date(now()),
            safetyWaitUntil: null,
            safetyWaitReason: null,
          },
        });
        return true;
      },
      { timeout: 60000 },
    );
    if (!claimed || !provider || !candidate) return;
    // Rendering/decryption can fail safely before the transport-start marker.
    let connection: ReturnType<typeof unlocked>;
    try {
      connection = unlocked(provider);
    } catch {
      await db.providerConnection.updateMany({
        where: {
          id: provider.id,
          userId: initial.userId,
          revision: provider.revision,
        },
        data: { enabled: false, health: "CONFIG_ERROR" },
      });
      throw new Error(
        "Provider credentials could not be opened. Update and verify the connection.",
      );
    }
    const message = deliveryMessage(
      initial.campaign.message,
      initial.email,
      initial.unsubscribeToken,
    );
    transmitted = await db.$transaction(
      async (tx) => {
        await lockSafety(tx, initial.userId);
        await lockCampaign(tx, initial.campaignId);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: initial.userId },
        });
        const c = await tx.campaign.findUniqueOrThrow({
          where: { id: initial.campaignId },
        });
        const a = await tx.deliveryAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        });
        const p = await tx.providerConnection.findUniqueOrThrow({
          where: { id: provider!.id },
        });
        if (
          a.state !== "RESERVED" ||
          Date.now() - permitAt > 20000 ||
          !["QUEUED", "SENDING"].includes(c.state) ||
          user.safetyPausedReason ||
          c.safetyPausedReason ||
          p.revision !== provider!.revision ||
          !(await providerStillAuthorized(
            tx,
            initial.userId,
            p.id,
            senderIdentityId,
          )) ||
          (await tx.providerConnection.count({
            where: { userId: initial.userId, health: "POLICY_BLOCKED" },
          })) ||
          (await tx.suppression.count({
            where: {
              userId: initial.userId,
              email: { in: [initial.email, ...snapshot.cc, ...snapshot.bcc] },
            },
          }))
        )
          return false;
        const governor = await ensureGovernor(tx, initial.userId, clock);
        const currentSettings = safetySettings.parse(user.safetySettings);
        const currentUsage = await governor.inspect(
          [
            ...commonBudgets(currentSettings, domain, c.id, c.dailyBudget),
            {
              scope: "provider:" + p.id,
              limit: p.dailyBudgetOverride ?? currentSettings.providerDaily,
            },
          ],
          cost,
        );
        if (currentUsage.some((b) => b.limit !== null && b.used > b.limit))
          return false;
        if (!(await governor.commit(attemptId))) return false;
        await tx.deliveryAttempt.update({
          where: { id: attemptId },
          data: { state: "PROCESSING", transmissionStartedAt: new Date(now()) },
        });
        return true;
      },
      { timeout: 60000 },
    );
    if (!transmitted) return;
    let outcome: SendResult;
    try {
      outcome = await sendMessage(connection, message, {
        attemptId,
        idempotencyKey: attemptId,
      });
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
      await lockSafety(tx, initial.userId);
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
            where: { id: provider!.id, revision: provider!.revision },
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
            where: { id: provider!.id, revision: provider!.revision },
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
            where: { id: provider!.id, revision: provider!.revision },
            data: {
              cooldownUntil: new Date(
                Date.now() + Math.max(30000, outcome.error.retryAfterMs ?? 0),
              ),
            },
          });
      }
      if (outcome.status === "accepted")
        await checkExistingSafetyOutcomes(
          tx,
          initial.userId,
          initial.campaignId,
        );
      await tx.activityEvent.create({
        data: {
          userId: initial.userId,
          campaignId: initial.campaignId,
          deliveryId: id,
          providerName: provider!.name,
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
      providerConnectionId: provider.id,
      status: outcome.status,
    });
  } finally {
    if (!transmitted)
      await db.$transaction(
        async (tx) => {
          await lockSafety(tx, initial.userId);
          const a = await tx.deliveryAttempt.findUnique({
            where: { id: attemptId },
          });
          if (a && !a.transmissionStartedAt && a.state !== "NOT_STARTED") {
            await tx.deliveryAttempt.update({
              where: { id: attemptId },
              data: { state: "NOT_STARTED", finishedAt: new Date(now()) },
            });
            const c = await tx.campaign.findUniqueOrThrow({
              where: { id: initial.campaignId },
            });
            await tx.delivery.updateMany({
              where: { id, claimId: attemptId, state: "PROCESSING" },
              data: {
                state: ["CANCELLING", "CANCELLED"].includes(c.state)
                  ? "CANCELLED"
                  : "DEFERRED",
                nextAttemptAt: new Date(now() + 1000),
                attemptCount: { decrement: 1 },
                claimId: null,
                claimedAt: null,
              },
            });
            await tx.providerConnection.updateMany({
              where: {
                id: { in: quotaPeers },
                quotaRemaining: { not: null },
                OR: [
                  { quotaCheckedAt: null },
                  { quotaCheckedAt: { lte: a.startedAt } },
                ],
              },
              data: { quotaRemaining: { increment: cost } },
            });
            await ensureGovernor(tx, initial.userId, clock, true);
            await wakeSafetyWaiters(tx, initial.userId);
          } else if (!a) {
            const governor = await ensureGovernor(tx, initial.userId, clock);
            if (await governor.release(attemptId))
              await wakeSafetyWaiters(tx, initial.userId);
          }
        },
        { timeout: 60000 },
      );
    if (candidate) await releaseProvider(initial.userId, candidate, attemptId);
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
      await lockSafety(tx, d.userId);
      await lockCampaign(tx, d.campaignId);
      const reserved = await tx.deliveryAttempt.findFirst({
        where: {
          id: d.claimId ?? "",
          state: "RESERVED",
          transmissionStartedAt: null,
          safetyReservedAt: { not: null },
        },
      });
      if (reserved) {
        await tx.deliveryAttempt.update({
          where: { id: reserved.id },
          data: { state: "NOT_STARTED", finishedAt: new Date() },
        });
        const c = await tx.campaign.findUniqueOrThrow({
          where: { id: d.campaignId },
        });
        await tx.delivery.updateMany({
          where: { id: d.id, claimId: d.claimId, state: "PROCESSING" },
          data: {
            state: ["CANCELLING", "CANCELLED"].includes(c.state)
              ? "CANCELLED"
              : "DEFERRED",
            nextAttemptAt: new Date(),
            claimId: null,
            claimedAt: null,
            attemptCount: { decrement: 1 },
          },
        });
        const provider = await tx.providerConnection.findUniqueOrThrow({
          where: { id: reserved.providerId },
        });
        const peers = await tx.providerConnection.findMany({
          where: { userId: d.userId },
        });
        const from = (c.message as { from: string }).from;
        const group = rateGroup(
          d.userId,
          provider.type,
          from,
          (provider.settings as ConnectionInput["settings"]).region,
        );
        await tx.providerConnection.updateMany({
          where: {
            id: {
              in: peers
                .filter(
                  (p) =>
                    rateGroup(
                      d.userId,
                      p.type,
                      from,
                      (p.settings as ConnectionInput["settings"]).region,
                    ) === group,
                )
                .map((p) => p.id),
            },
            quotaRemaining: { not: null },
            OR: [
              { quotaCheckedAt: null },
              { quotaCheckedAt: { lte: reserved.startedAt } },
            ],
          },
          data: { quotaRemaining: { increment: reserved.messageUnits } },
        });
        await ensureGovernor(tx, d.userId, undefined, true);
        await wakeSafetyWaiters(tx, d.userId);
        return;
      }
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
