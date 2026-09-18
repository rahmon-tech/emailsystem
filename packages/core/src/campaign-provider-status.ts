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
      campaignBlockReason: "This campaign has no From address.",
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

  const routeSenders = campaign.experimentRun
    ? poolSenders.filter((poolSender) => poolSender.id === sender.id)
    : poolSenders;
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
          routeSenders.some(
            (poolSender) =>
              poolSender.authorizedDomainId === authorization.authorizedDomainId &&
              authorizationAllowsSender(authorization, poolSender),
          ),
        )
        .map((authorization) => {
          const poolSender = routeSenders.find(
            (candidate) =>
              candidate.authorizedDomainId === authorization.authorizedDomainId &&
              authorizationAllowsSender(authorization, candidate),
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
  const providers = [
    ...new Map(
      providerScopes.map(({ provider }) => [provider.id, provider]),
    ).values(),
  ];
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
      ? "This controlled experiment has been stopped for the account."
      : campaign.experimentRun.state !== "RUNNING"
        ? "This controlled experiment is not active."
        : campaign.experimentRun.startsAt &&
            campaign.experimentRun.startsAt.getTime() > now
          ? "This experiment is not inside its approved start window yet."
          : !campaign.experimentRun.expiresAt
            ? "This controlled experiment has not been started with an end time."
            : campaign.experimentRun.expiresAt.getTime() <= now
              ? "This controlled experiment is outside its approved time window."
              : campaign.experimentRun.attemptsUsed >=
                  campaign.experimentRun.maxAttempts
                ? "This controlled experiment has reached its allowed number of send attempts."
                : !campaign.experimentRun.profile.senderScopes.some(
                      (scope) => scope.senderIdentityId === sender.id,
                    )
                  ? "This campaign\'s From address is not approved for the controlled experiment."
                  : null
    : null;
  const senderBlock = routeSenders.some(
    (poolSender) => poolSender.authorizedDomain.status === "VERIFIED",
  )
    ? null
    : "None of the selected sending domains is currently available.";
  const campaignBlockReason =
    experimentBlock ??
    senderBlock ??
    safety?.pausedReason ??
    (commonSafetyBlock
      ? "The 24-hour sending limit for this account or campaign has been reached."
      : commonMonthlyBlock
        ? "The monthly sending limit for this account has been reached."
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
          ? `${domain} has reached its 24-hour sending limit.`
          : domainMonthlyRemaining !== null && domainMonthlyRemaining < cost
            ? `${domain} has reached its monthly sending limit.`
            : streamType(provider.settings) === "transactional"
            ? "This connection is set up for test emails only, not campaigns."
            : needsInlineTransport && !supportsInlineAttachmentTransport(provider)
              ? "This sending service cannot send this campaign with its embedded image."
              : !provider.enabled
                ? "This sending service is turned off."
                : provider.health !== "HEALTHY"
                  ? `This sending service is unavailable (${provider.health.toLowerCase().replaceAll("_", " ")}).`
                  : provider.cooldownUntil && provider.cooldownUntil.getTime() > now
                    ? "This sending service is temporarily paused."
                    : provider.quotaRemaining !== null &&
                        provider.quotaRemaining < cost
                      ? "This sending service has no remaining sending allowance for another email."
                      : safetyRemaining !== null && safetyRemaining < cost
                        ? "This sending service has reached its 24-hour limit."
                        : monthlySafetyRemaining !== null &&
                            monthlySafetyRemaining < cost
                          ? "This sending service has reached its monthly limit."
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
