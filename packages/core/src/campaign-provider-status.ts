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
          expiresAt: true,
          profile: {
            select: {
              providerScopes: { select: { providerId: true } },
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

  const authorizations = await db.providerDomainAuthorization.findMany({
    where: {
      userId,
      authorizedDomainId: sender.authorizedDomainId,
      status: "VERIFIED",
    },
    select: {
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
  const providers = authorizations
    .filter((authorization) => authorizationAllowsSender(authorization, sender))
    .map((authorization) => authorization.providerConnection)
    .filter(
      (provider) =>
        !provider.deletedAt &&
        (!experimentProviderIds || experimentProviderIds.has(provider.id)),
    );

  const snapshot = campaign.message as unknown as CampaignSnapshot;
  const cost = messageCost({ cc: snapshot.cc ?? [], bcc: snapshot.bcc ?? [] });
  const needsInlineTransport =
    snapshot.attachments?.some(
      (attachment) => attachment.disposition === "inline",
    ) ?? false;
  const from = snapshot.from?.trim() ?? "";
  const safety = from
    ? await safetyCapacity(userId, from, campaign.id, () => now)
    : null;
  const telemetry = await providerPacingTelemetry(userId, providers, now);
  const telemetryById = new Map(telemetry.map((row) => [row.id, row]));
  const safetyByProvider = new Map(
    (safety?.providerUsage ?? []).map((usage) => [
      usage.scope.slice("provider:".length),
      usage,
    ]),
  );
  const commonSafetyBlock = safety?.usage.find(
    (usage) => usage.limit !== null && usage.used + cost > usage.limit,
  );
  const globalPolicyBlock = await db.providerConnection.findFirst({
    where: { userId, deletedAt: null, health: "POLICY_BLOCKED" },
    select: { id: true },
  });
  const experimentBlock = campaign.experimentRun
    ? campaign.experimentRun.state !== "RUNNING"
      ? "Experiment run is not active."
      : campaign.experimentRun.expiresAt &&
          campaign.experimentRun.expiresAt.getTime() <= now
        ? "Experiment run is outside its approved time window."
        : null
    : null;
  const senderBlock = !sender.enabled
    ? "Campaign sender is disabled."
    : sender.authorizedDomain.status !== "VERIFIED"
      ? "Campaign sender domain is not verified."
      : null;
  const campaignBlockReason = globalPolicyBlock
    ? "Provider enforcement requires review before campaign sending can continue."
    : experimentBlock ??
      senderBlock ??
      safety?.pausedReason ??
      (commonSafetyBlock
        ? "A shared account, sender-domain, or campaign safety budget is currently full."
        : null);

  const rows = providers.map((provider): CampaignProviderStatusRow => {
    const pacing = telemetryById.get(provider.id)!;
    const providerSafety = safetyByProvider.get(provider.id);
    const safetyRemaining =
      providerSafety?.limit === null || providerSafety?.limit === undefined
        ? null
        : Math.max(0, providerSafety.limit - providerSafety.used);
    const unavailableReason = campaignBlockReason
      ? campaignBlockReason
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
                : provider.quotaRemaining !== null && provider.quotaRemaining < cost
                  ? "Provider quota is below one message unit."
                  : safetyRemaining !== null && safetyRemaining < cost
                    ? "Provider safety budget is currently full."
                    : null;
    return {
      ...pacing,
      eligible: unavailableReason === null,
      unavailableReason,
      quotaRemaining: provider.quotaRemaining,
      safetyRemaining,
    };
  });

  return {
    scopedProviderCount: rows.length,
    eligibleProviderCount: rows.filter((provider) => provider.eligible).length,
    campaignBlockReason,
    providers: rows,
  };
}
