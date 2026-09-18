import { checkExistingSafetyOutcomes } from "./safety-brakes";
import { randomUUID } from "node:crypto";
import { db } from "@emailsystem/db";
import { send } from "@emailsystem/providers";
import { supportsInlineAttachmentTransport } from "@emailsystem/providers/capabilities";
import type { SendResult, ConnectionInput } from "@emailsystem/providers";
import { unlocked } from "./providers";
import {
  acquireExperimentPacing,
  acquireProvider,
  commitExperimentPacing,
  releaseExperimentPacing,
  releaseProvider,
  rateGroup,
} from "./dispatcher";
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
  monthWindowUtc,
  providerMonthlyUsage,
  sharedMonthlyUsage,
} from "./safety";
import { safetySettings, messageCost } from "./safety-config";
import type { Candidate } from "./dispatcher";
import {
  providerStillAuthorized,
  selectDeliverySender,
} from "./senders";
import {
  experimentDispatchScope,
  experimentVariables,
  reserveExperimentTransport,
} from "./experiments";
import {
  appendExperimentEvidence,
  experimentRecipientHash,
} from "./experiment-evidence";
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
    attachments?: { disposition?: string }[];
    senderPool?: {
      enabled?: boolean;
      domainIds?: string[];
      domains?: string[];
    };
  };
  const needsInlineTransport =
    snapshot.attachments?.some(
      (attachment) => attachment.disposition === "inline",
    ) ?? false;
  const senderIdentityId = initial.campaign.senderIdentityId;
  if (!senderIdentityId) return;
  const cost = messageCost(snapshot);
  let domain = senderDomain(snapshot.from);
  const attemptId = randomUUID();
  let provider:
    | Awaited<ReturnType<typeof db.providerConnection.findFirstOrThrow>>
    | undefined;
  let candidate: Candidate | undefined;
  let selectedSender:
    | { id: string; email: string; displayName: string; replyTo: string }
    | undefined;
  let quotaPeers: string[] = [];
  let transmitted = false;
  let permitAt = 0;
  let experimentPacing:
    | {
        runId: string;
        profile: "smooth";
        configuredIntervalMs: number;
        effectiveMinimumIntervalMs: number;
      }
    | undefined;
  let experimentPacingReserved = false;
  let experimentPacingCommitted = false;
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
              message: "Recipient or copy address is on the do-not-send list.",
            },
          });
          return false;
        }
        const experimentScope = await experimentDispatchScope(tx, {
          userId: initial.userId,
          runId: c.experimentRunId,
          senderIdentityId,
          now: new Date(now()),
        });
        if (!experimentScope.allowed) {
          await tx.campaign.updateMany({
            where: { id: c.id, state: { in: ["QUEUED", "SENDING"] } },
            data: { state: "PAUSED", safeError: experimentScope.reason },
          });
          return false;
        }
        experimentPacing = undefined;
        if (c.experimentRunId) {
          const run = await tx.experimentRun.findFirst({
            where: { id: c.experimentRunId, userId: initial.userId },
            select: { profile: { select: { variables: true } } },
          });
          if (run) {
            const variables = experimentVariables.parse(run.profile.variables);
            const interval = variables.pacingIntervalMs ?? 0;
            if (variables.pacingProfile === "smooth" && interval > 0)
              experimentPacing = {
                runId: c.experimentRunId,
                profile: "smooth",
                configuredIntervalMs: interval,
                effectiveMinimumIntervalMs: interval,
              };
          }
        }
        const scopedProviderIds = experimentScope.providerIds
          ? new Set(experimentScope.providerIds)
          : null;
        const preSettings = safetySettings.parse(user.safetySettings);
        const preGovernor = await ensureGovernor(tx, initial.userId, clock);
        const poolDomainIds = snapshot.senderPool?.domainIds ?? [];
        const poolDomains = snapshot.senderPool?.domains ?? [];
        let capacityDomainIds = poolDomainIds;
        if (
          poolDomainIds.length &&
          poolDomains.length === poolDomainIds.length
        ) {
          const rollingDomainUsage = await preGovernor.inspect(
            poolDomains.map((poolDomain) => ({
              scope: "domain:" + poolDomain,
              limit: preSettings.domainDaily,
            })),
            cost,
          );
          const sharedMonth = await sharedMonthlyUsage(
            tx,
            initial.userId,
            poolDomains,
            clock,
          );
          capacityDomainIds = poolDomainIds.filter((domainId, index) => {
            const poolDomain = poolDomains[index];
            const rolling = rollingDomainUsage.find(
              (usage) => usage.scope === "domain:" + poolDomain,
            );
            const rollingOpen =
              !rolling ||
              rolling.limit === null ||
              rolling.used + cost <= rolling.limit;
            const monthUsed = sharedMonth.byDomain.get(poolDomain) ?? 0;
            const monthlyOpen =
              preSettings.domainMonthly === null ||
              monthUsed + cost <= preSettings.domainMonthly;
            return rollingOpen && monthlyOpen;
          });
        }

        const routeProviders = await tx.providerConnection.findMany({
          where: {
            userId: initial.userId,
            deletedAt: null,
            enabled: true,
            health: "HEALTHY",
            OR: [
              { cooldownUntil: null },
              { cooldownUntil: { lte: new Date(now()) } },
            ],
          },
        });
        const routeDailyUsage = routeProviders.length
          ? await preGovernor.inspect(
              routeProviders.map((routeProvider) => ({
                scope: "provider:" + routeProvider.id,
                limit:
                  routeProvider.dailyBudgetOverride ??
                  preSettings.providerDaily,
              })),
              cost,
            )
          : [];
        const routeMonthlyUsage = await providerMonthlyUsage(
          tx,
          initial.userId,
          routeProviders.map((routeProvider) => routeProvider.id),
          clock,
        );
        const capacityProviderIds = routeProviders
          .filter((routeProvider) => {
            const daily = routeDailyUsage.find(
              (usage) => usage.scope === "provider:" + routeProvider.id,
            );
            return (
              (!scopedProviderIds || scopedProviderIds.has(routeProvider.id)) &&
              (!needsInlineTransport ||
                supportsInlineAttachmentTransport(routeProvider)) &&
              (routeProvider.quotaRemaining === null ||
                routeProvider.quotaRemaining >= cost) &&
              (!daily ||
                daily.limit === null ||
                daily.used + cost <= daily.limit) &&
              (routeProvider.monthlyBudgetOverride === null ||
                (routeMonthlyUsage.get(routeProvider.id) ?? 0) + cost <=
                  routeProvider.monthlyBudgetOverride)
            );
          })
          .map((routeProvider) => routeProvider.id);

        const senderSelection = await selectDeliverySender(
          tx,
          initial.userId,
          senderIdentityId,
          id,
          Boolean(snapshot.senderPool?.enabled) && !c.experimentRunId,
          snapshot.senderPool?.domainIds ? capacityDomainIds : undefined,
          capacityProviderIds,
        );
        if (!senderSelection) {
          await waitForSafety(
            tx,
            c,
            [],
            now() + 60000,
            now(),
            "None of the selected domains has a From address and sending service available right now. EmailSystem will keep checking.",
          );
          return false;
        }
        selectedSender = {
          id: senderSelection.sender.id,
          email: senderSelection.sender.email,
          displayName: senderSelection.sender.displayName,
          replyTo: senderSelection.sender.replyTo,
        };
        domain = senderDomain(selectedSender.email);
        const authorized = senderSelection.providers;
        const eligible = authorized.filter(
          (p) =>
            (p.quotaRemaining === null || p.quotaRemaining >= cost) &&
            (!scopedProviderIds || scopedProviderIds.has(p.id)) &&
            (!needsInlineTransport || supportsInlineAttachmentTransport(p)),
        );
        if (!eligible.length) {
          await waitForSafety(
            tx,
            c,
            [],
            now() + 60000,
            now(),
            needsInlineTransport
              ? "None of the available sending services can send this message with its embedded image right now."
              : c.experimentRunId
                ? "None of the approved sending services is available for this controlled experiment right now."
                : "No sending service is available right now. Check whether a connection is turned off, temporarily paused, or has reached its limit.",
          );
          return false;
        }
        const settings = safetySettings.parse(user.safetySettings);
        const sharedMonthly = await sharedMonthlyUsage(
          tx,
          initial.userId,
          [domain],
          clock,
        );
        const monthlyBlocked = [
          {
            scope: "account-month",
            used: sharedMonthly.account,
            limit: settings.accountMonthly,
          },
          {
            scope: "domain-month:" + domain,
            used: sharedMonthly.byDomain.get(domain) ?? 0,
            limit: settings.domainMonthly,
          },
        ].filter(
          (budget) =>
            budget.limit !== null && budget.used + cost > budget.limit,
        );
        if (monthlyBlocked.length) {
          await waitForSafety(
            tx,
            c,
            monthlyBlocked.map((budget) => budget.scope),
            monthWindowUtc(now()).next,
            now(),
            "A monthly sending limit has been reached. Sending will continue automatically when the next UTC month begins.",
          );
          return false;
        }
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
        const dailyAvailable = eligible.filter((p) => {
          const b = usage.find((b) => b.scope === "provider:" + p.id)!;
          return b.limit === null || b.used + cost <= b.limit;
        });
        if (commonBlocked.length || !dailyAvailable.length) {
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
        const monthlyUsage = await providerMonthlyUsage(
          tx,
          initial.userId,
          dailyAvailable.map((provider) => provider.id),
          clock,
        );
        const available = dailyAvailable.filter(
          (provider) =>
            provider.monthlyBudgetOverride === null ||
            (monthlyUsage.get(provider.id) ?? 0) + cost <=
              provider.monthlyBudgetOverride,
        );
        if (!available.length) {
          await waitForSafety(
            tx,
            c,
            dailyAvailable.map((provider) => "provider-month:" + provider.id),
            monthWindowUtc(now()).next,
            now(),
            "A sending service has reached its monthly limit. EmailSystem will use another available service, or continue when the next UTC month begins.",
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
            p.id,
            selectedSender!.email,
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
            p.id,
            selectedSender!.email,
            (p.settings as ConnectionInput["settings"]).region,
          ),
        }));
        if (experimentPacing) {
          const pacingPermit = await acquireExperimentPacing(
            initial.userId,
            experimentPacing.runId,
            attemptId,
            experimentPacing.effectiveMinimumIntervalMs,
          );
          if (!pacingPermit.allowed) {
            await waitForSafety(
              tx,
              c,
              [],
              pacingPermit.nextAllowedAt,
              now(),
              "This controlled experiment is waiting for its next scheduled send interval.",
            );
            return false;
          }
          experimentPacingReserved = true;
        }
        permitAt = Date.now();
        const chosen = await acquireProvider(
          initial.userId,
          candidates,
          attemptId,
          ratePeers,
          process.env.NODE_ENV !== "test",
          settings.warmupProfile,
          {
            accountPerMinute: settings.accountPerMinute,
            domainPerMinute: settings.domainPerMinute,
            campaignId: c.id,
            campaignPerMinute: settings.campaignPerMinute,
          },
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
        // Each connection owns its own provider allowance. The rate-group
        // key already includes the chosen connection ID, so only that
        // connection's remaining allowance is consumed.
        quotaPeers = [chosen];
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
    if (!claimed || !provider || !candidate || !selectedSender) return;
    const deliverySender = selectedSender;
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
        "The saved credentials for this sending service could not be used. Update the connection and check it again.",
      );
    }
    const baseMessage = deliveryMessage(
      initial.campaign.message,
      initial.email,
      initial.unsubscribeToken,
    );
    const message = {
      ...baseMessage,
      from: deliverySender.email,
      fromName: deliverySender.displayName,
      replyTo: deliverySender.replyTo || baseMessage.replyTo,
    };
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
          (needsInlineTransport && !supportsInlineAttachmentTransport(p)) ||
          !(await providerStillAuthorized(
            tx,
            initial.userId,
            p.id,
            deliverySender.id,
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
        if (p.monthlyBudgetOverride !== null) {
          const monthlyUsage = await providerMonthlyUsage(
            tx,
            initial.userId,
            [p.id],
            clock,
          );
          if (
            (monthlyUsage.get(p.id) ?? 0) > p.monthlyBudgetOverride
          )
            return false;
        }
        if (!(await governor.commit(attemptId))) return false;
        const transmissionStartedAt = new Date(now());
        const experimentReservation = await reserveExperimentTransport(tx, {
          userId: initial.userId,
          runId: c.experimentRunId,
          campaignId: c.id,
          senderIdentityId: deliverySender.id,
          providerId: p.id,
          recipient: initial.email,
          attemptId,
          now: transmissionStartedAt,
        });
        if (!experimentReservation.allowed) {
          if (!experimentReservation.retryable) {
            await tx.campaign.updateMany({
              where: { id: c.id, state: { in: ["QUEUED", "SENDING"] } },
              data: {
                state: "PAUSED",
                safeError: experimentReservation.reason,
              },
            });
          }
          return false;
        }
        if (experimentPacing && experimentPacingReserved) {
          if (
            !(await commitExperimentPacing(
              initial.userId,
              experimentPacing.runId,
              attemptId,
            ))
          )
            return false;
          experimentPacingCommitted = true;
        }
        await tx.deliveryAttempt.update({
          where: { id: attemptId },
          data: {
            state: "PROCESSING",
            transmissionStartedAt,
            experimentRunId: experimentReservation.experimentRunId,
          },
        });
        if (c.experimentRunId)
          await appendExperimentEvidence(tx, {
            userId: initial.userId,
            runId: c.experimentRunId,
            kind: "transport.started",
            attemptId,
            providerId: p.id,
            campaignId: c.id,
            createdAt: transmissionStartedAt,
            payload: {
              recipientHash: experimentRecipientHash(
                c.experimentRunId,
                initial.email,
              ),
              senderIdentityId: deliverySender.id,
              senderDomain: domain,
              messageUnits: cost,
              provider: {
                type: p.type,
                transport: p.transport,
                revision: p.revision,
                health: p.health,
                cooldownUntil: p.cooldownUntil,
                perSecond: p.perSecond,
                perMinute: p.perMinute,
                concurrency: p.concurrency,
              },
              pacing: {
                warmupProfile: currentSettings.warmupProfile,
                accountPerMinute: currentSettings.accountPerMinute,
                domainPerMinute: currentSettings.domainPerMinute,
                campaignPerMinute: currentSettings.campaignPerMinute,
                rateGroup: candidate!.group,
              },
              experimentControls:
                experimentReservation.controls || experimentPacing
                  ? {
                      ...(experimentReservation.controls
                        ? {
                            concurrency: {
                              cap: experimentReservation.controls.concurrencyCap,
                              activeBeforeStart:
                                experimentReservation.controls
                                  .activeTransportsBeforeStart,
                              activeAfterStart:
                                experimentReservation.controls
                                  .activeTransportsBeforeStart === null
                                  ? null
                                  : experimentReservation.controls
                                      .activeTransportsBeforeStart + 1,
                            },
                          }
                        : {}),
                      ...(experimentPacing
                        ? {
                            pacing: {
                              profile: experimentPacing.profile,
                              configuredIntervalMs:
                                experimentPacing.configuredIntervalMs,
                              effectiveMinimumIntervalMs:
                                experimentPacing.effectiveMinimumIntervalMs,
                            },
                          }
                        : {}),
                    }
                  : null,
              copies: snapshot.cc.length + snapshot.bcc.length,
            },
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
          message: "The final delivery result is unclear and must be checked before retrying.",
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
          if (pending)
            await tx.delivery.update({
              where: { id },
              data: {
                state: "DEFERRED",
                nextAttemptAt: new Date(Date.now() + 1000),
                safeError:
                  "This sending service was removed from the campaign after it rejected further sending. Trying another available service.",
              },
            });
        } else if (
          ["authentication", "authorization", "sender_configuration"].includes(
            outcome.error.category,
          )
        ) {
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
          if (pending)
            await tx.delivery.update({
              where: { id },
              data: {
                state: "DEFERRED",
                nextAttemptAt: new Date(Date.now() + 1000),
                safeError:
                  "This connection was turned off after a permanent setup error. Trying another available connection.",
              },
            });
        }
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
      if (initial.campaign.experimentRunId) {
        const [attemptAfter, deliveryAfter, providerAfter] = await Promise.all([
          tx.deliveryAttempt.findUniqueOrThrow({
            where: { id: attemptId },
            select: {
              state: true,
              providerMessageId: true,
              category: true,
              safeError: true,
              finishedAt: true,
            },
          }),
          tx.delivery.findUniqueOrThrow({
            where: { id },
            select: { state: true, nextAttemptAt: true },
          }),
          tx.providerConnection.findUniqueOrThrow({
            where: { id: provider!.id },
            select: { health: true, enabled: true, cooldownUntil: true },
          }),
        ]);
        await appendExperimentEvidence(tx, {
          userId: initial.userId,
          runId: initial.campaign.experimentRunId,
          kind: "transport.outcome",
          attemptId,
          providerId: provider!.id,
          campaignId: initial.campaignId,
          createdAt: attemptAfter.finishedAt ?? new Date(),
          payload: {
            status: outcome.status,
            providerMessageId: attemptAfter.providerMessageId,
            category: attemptAfter.category,
            safeError: attemptAfter.safeError,
            retryAfterMs:
              outcome.status === "accepted" ? null : outcome.error.retryAfterMs ?? null,
            attemptState: attemptAfter.state,
            deliveryState: deliveryAfter.state,
            nextAttemptAt: deliveryAfter.nextAttemptAt,
            providerHealth: providerAfter.health,
            providerEnabled: providerAfter.enabled,
            cooldownUntil: providerAfter.cooldownUntil,
            enforcementStopped:
              outcome.status !== "accepted" && outcome.error.category === "policy",
          },
        });
      }
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
    if (
      experimentPacing &&
      experimentPacingReserved &&
      !experimentPacingCommitted
    )
      await releaseExperimentPacing(
        initial.userId,
        experimentPacing.runId,
        attemptId,
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
          provider.id,
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
                      p.id,
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
            "Sending was interrupted. EmailSystem must confirm the previous result before retrying.",
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
            message: "An interrupted send is waiting for its final result to be confirmed.",
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
      const completedAt = new Date();
      await tx.campaign.update({
        where: { id: c.id },
        data: {
          state:
            current.state === "CANCELLING"
              ? "CANCELLED"
              : errors
                ? "COMPLETED_WITH_ERRORS"
                : "COMPLETED",
          completedAt,
        },
      });
      if (current.experimentRunId)
        await tx.experimentRun.updateMany({
          where: {
            id: current.experimentRunId,
            userId: current.userId,
            state: "RUNNING",
          },
          data: {
            state: "COMPLETED",
            stoppedAt: completedAt,
            stopReason: "Bound campaign finished.",
          },
        });
    });
}
