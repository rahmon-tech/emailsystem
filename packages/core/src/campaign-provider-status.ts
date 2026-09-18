import { db } from "@emailsystem/db";
import type { ConnectionInput } from "@emailsystem/providers";
import { supportsInlineAttachmentTransport } from "@emailsystem/providers/capabilities";
import { AppError } from "./errors";
import {
  providerPacingTelemetry,
  type ProviderPacingTelemetry,
} from "./provider-pacing-telemetry";
import { safetyCapacity } from "./safety";
import { messageCost } from "./safety-config";
import { authorizationAllowsSender } from "./senders";

type CampaignProviderStatusRow = ProviderPacingTelemetry & {
  eligible: boolean;
  unavailableReason: string | null;
  quotaRemaining: number | null;
  safetyRemaining: number | null;
  monthlySafetyRemaining: number | null;
  monthlyUsed: number;
  monthlyLimit: number | null;
  domain: string;
};

export type CampaignProviderStatus = {
  scopedProviderCount: number;
  eligibleProviderCount: number;
  campaignBlockReason: string | null;
  providers: CampaignProviderStatusRow[];
};

type CampaignSnapshot = {
  from?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: { disposition?: string }[];
  senderPool?: { domainIds?: string[]; domains?: string[] };
};

function streamType(settings: unknown) {
  return (settings as ConnectionInput["settings"]).messageStreamType;
}

export async function campaignProviderStatus(
  userId: string,
  campaignId: string,
  now = Date.now(),
): Promise<CampaignProviderStatus> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, userId },
    select: {
      id: true,
      user: { select: { experimentKillSwitchAt: true } },
      senderIdentity: {
        select: {
          id: true,
          enabled: true,
          authorizedDomainId: true,
          authorizedDomain: { select: { status: true } },
        },
      },
      experimentRun: {
        select: {
          state: true,
          attemptsUsed: true,
          maxAttempts: true,
          startsAt: true,
          expiresAt: true,
          profile: {
            select: {
              providerScopes: { select: { providerId: true } },
              senderScopes: { select: { senderIdentityId: true } },
            },
          },
        },
      },
      message: true,
    },
  });
  if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found.");

  const sender = campaign.senderIdentity;
  if (!sender)
    return {
      scopedProviderCount: 0,
      eligibleProviderCount: 0,
      campaignBlockReason: "Campaign has no sender identity.",
      providers: [],
    };

  const snapshot = campaign.message as unknown as CampaignSnapshot;
  const domainIds = [
    ...new Set(
      snapshot.senderPool?.domainIds?.length
        ? snapshot.senderPool.domainIds
        : [sender.authorizedDomainId],
    ),
  ];
  const poolSenders = await db.senderIdentity.findMany({
    where: {
      userId,
      authorizedDomainId: { in: domainIds },
      enabled: true,
    },
    select: {
      id: true,
      authorizedDomainId: true,
      authorizedDomain: {
        select: { id: true, domain: true, status: true },
      },
    },
  });
  const authorizations = await db.providerDomainAuthorization.findMany({
    where: {
      userId,
      authorizedDomainId: { in: domainIds },
      status: "VERIFIED",
    },
    select: {
      authorizedDomainId: true,
      status: true,
      scope: true,
      senderAuthorizations: { select: { senderIdentityId: true } },
      providerConnection: {
        select: {
          id: true,
          name: true,
          type: true,
          transport: true,
          settings: true,
          enabled: true,
          health: true,
          perMinute: true,
          cooldownUntil: true,
          quotaRemaining: true,
          dailyBudgetOverride: true,
          monthlyBudgetOverride: true,
          deletedAt: true,
        },
      },
    },
  });

  const experimentProviderIds = campaign.experimentRun
    ? new Set(
        campaign.experimentRun.profile.providerScopes.map(
          (scope) => scope.providerId,
        ),
      )
    : null;
  const providerScopes = [
    ...new Map(
      authorizations
        .filter((authorization) =>
          poolSenders.some(
            (poolSender) =>
              poolSender.authorizedDomainId === authorization.authorizedDomainId &&
              authorizationAllowsSender(authorization, poolSender),
          ),
        )
        .map((authorization) => {
          const poolSender = poolSenders.find(
            (candidate) =>
              candidate.authorizedDomainId === authorization.authorizedDomainId,
          )!;
          return [
            `${authorization.providerConnection.id}:${poolSender.authorizedDomain.domain}`,
            {
              provider: authorization.providerConnection,
              domain: poolSender.authorizedDomain.domain,
            },
          ] as const;
        }),
    ).values(),
  ].filter(
    ({ provider }) =>
      !provider.deletedAt &&
      (!experimentProviderIds || experimentProviderIds.has(provider.id)),
  );
  const providers = providerScopes.map(({ provider }) => provider);
  const cost = messageCost({ cc: snapshot.cc ?? [], bcc: snapshot.bcc ?? [] });
  const needsInlineTransport =
    snapshot.attachments?.some(
      (attachment) => attachment.disposition === "inline",
    ) ?? false;
  const from = snapshot.from?.trim() ?? "";
  const poolDomains = [
    ...new Set(
      poolSenders.map((poolSender) => poolSender.authorizedDomain.domain),
    ),
  ];
  const safetyRows = await Promise.all(
    (poolDomains.length
      ? poolDomains.map((domain) => `activity@${domain}`)
      : from
        ? [from]
        : []
    ).map((address) => safetyCapacity(userId, address, campaign.id, () => now)),
  );
  const safety = safetyRows[0] ?? null;
  const domainSafety = new Map(
    safetyRows.map((row) => [
      row.domain,
      row.usage.find((usage) => usage.scope.startsWith("domain:")),
    ]),
  );
  const domainMonthlySafety = new Map(
    safetyRows.map((row) => [
      row.domain,
      row.monthlyUsage.find((usage) =>
        usage.scope.startsWith("domain-month:"),
      ),
    ]),
  );
  const telemetry = await providerPacingTelemetry(userId, providers, now);
  const telemetryById = new Map(telemetry.map((row) => [row.id, row]));
  const safetyByProvider = new Map(
    (safety?.providerUsage ?? []).map((usage) => [
      usage.scope.slice("provider:".length),
      usage,
    ]),
  );
  const monthlySafetyByProvider = new Map(
    (safety?.providerMonthlyUsage ?? []).map((usage) => [
      usage.scope.slice("provider-month:".length),
      usage,
    ]),
  );
  const commonSafetyBlock = safety?.usage.find(
    (usage) =>
      !usage.scope.startsWith("domain:") &&
      usage.limit !== null &&
      usage.used + cost > usage.limit,
  );
  const commonMonthlyBlock = safety?.monthlyUsage.find(
    (usage) =>
      usage.scope === "account-month" &&
      usage.limit !== null &&
      usage.used + cost > usage.limit,
  );
  const experimentBlock = campaign.experimentRun
    ? campaign.user.experimentKillSwitchAt
      ? "Experiment transport is disabled by the account kill switch."
      : campaign.experimentRun.state !== "RUNNING"
        ? "Experiment run is not active."
        : campaign.experimentRun.startsAt &&
            campaign.experimentRun.startsAt.getTime() > now
          ? "This experiment is not inside its approved start window yet."
          : !campaign.experimentRun.expiresAt
            ? "This experiment run has not been started with a bounded expiry."
            : campaign.experimentRun.expiresAt.getTime() <= now
              ? "This experiment run is outside its approved time window."
              : campaign.experimentRun.attemptsUsed >=
                  campaign.experimentRun.maxAttempts
                ? "Experiment attempt ceiling reached; no further transport starts are allowed."
                : !campaign.experimentRun.profile.senderScopes.some(
                      (scope) => scope.senderIdentityId === sender.id,
                    )
                  ? "Campaign sender is outside the approved experiment scope."
                  : null
    : null;
  const senderBlock = poolSenders.some(
    (poolSender) => poolSender.authorizedDomain.status === "VERIFIED",
  )
    ? null
    : "No enabled verified sending domain remains in this campaign pool.";
  const campaignBlockReason =
    experimentBlock ??
    senderBlock ??
    safety?.pausedReason ??
    (commonSafetyBlock
      ? "A shared account or campaign 24-hour safety budget is currently full."
      : commonMonthlyBlock
        ? "The shared account monthly safety budget is currently full."
        : null);

  const rows = providerScopes.map(
    ({ provider, domain }): CampaignProviderStatusRow => {
      const pacing = telemetryById.get(provider.id)!;
      const providerSafety = safetyByProvider.get(provider.id);
      const monthlySafety = monthlySafetyByProvider.get(provider.id);
      const selectedDomainSafety = domainSafety.get(domain);
      const selectedDomainMonthlySafety = domainMonthlySafety.get(domain);
      const safetyRemaining =
        providerSafety?.limit === null || providerSafety?.limit === undefined
          ? null
          : Math.max(0, providerSafety.limit - providerSafety.used);
      const monthlySafetyRemaining =
        monthlySafety?.limit === null || monthlySafety?.limit === undefined
          ? null
          : Math.max(0, monthlySafety.limit - monthlySafety.used);
      const domainRemaining =
        selectedDomainSafety?.limit === null ||
        selectedDomainSafety?.limit === undefined
          ? null
          : Math.max(
              0,
              selectedDomainSafety.limit - selectedDomainSafety.used,
            );
      const domainMonthlyRemaining =
        selectedDomainMonthlySafety?.limit === null ||
        selectedDomainMonthlySafety?.limit === undefined
          ? null
          : Math.max(
              0,
              selectedDomainMonthlySafety.limit -
                selectedDomainMonthlySafety.used,
            );
      const unavailableReason = campaignBlockReason
        ? campaignBlockReason
        : domainRemaining !== null && domainRemaining < cost
          ? `${domain} has reached its shared 24-hour safety capacity.`
          : domainMonthlyRemaining !== null && domainMonthlyRemaining < cost
            ? `${domain} has reached its shared monthly safety capacity.`
            : streamType(provider.settings) === "transactional"
            ? "Transactional-only stream is not campaign eligible."
            : needsInlineTransport && !supportsInlineAttachmentTransport(provider)
              ? "Provider transport does not support this campaign's inline CID assets."
              : !provider.enabled
                ? "Provider is disabled."
                : provider.health !== "HEALTHY"
                  ? `Provider health is ${provider.health.toLowerCase().replaceAll("_", " ")}.`
                  : provider.cooldownUntil && provider.cooldownUntil.getTime() > now
                    ? "Provider is cooling down."
                    : provider.quotaRemaining !== null &&
                        provider.quotaRemaining < cost
                      ? "Provider quota is below one message unit."
                      : safetyRemaining !== null && safetyRemaining < cost
                        ? "Provider daily safety budget is currently full."
                        : monthlySafetyRemaining !== null &&
                            monthlySafetyRemaining < cost
                          ? "Provider monthly safety budget is currently full."
                          : null;
      return {
        ...pacing,
        eligible: unavailableReason === null,
        unavailableReason,
        quotaRemaining: provider.quotaRemaining,
        safetyRemaining,
        monthlySafetyRemaining,
        monthlyUsed: monthlySafety?.used ?? 0,
        monthlyLimit: monthlySafety?.limit ?? null,
        domain,
      };
    },
  );

  return {
    scopedProviderCount: rows.length,
    eligibleProviderCount: rows.filter((provider) => provider.eligible).length,
    campaignBlockReason,
    providers: rows,
  };
}
