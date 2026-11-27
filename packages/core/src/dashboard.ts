import { db } from "@emailsystem/db";
import { listSenders } from "./senders";

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function dashboard(userId: string, now = new Date()) {
  const start = monthStart(now);
  const [
    providers,
    senderCatalog,
    savedLists,
    campaignCount,
    recentCampaigns,
    deliveryStates,
    user,
    domainPauses,
    suppressions,
  ] = await Promise.all([
    db.providerConnection.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        enabled: true,
        health: true,
        cooldownUntil: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    listSenders(userId),
    db.contactImport.count({ where: { userId, state: "READY" } }),
    db.campaign.count({ where: { userId } }),
    db.campaign.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        state: true,
        intendedRecipientCount: true,
        scheduledAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    }),
    db.delivery.groupBy({
      by: ["state"],
      where: { userId, createdAt: { gte: start } },
      _count: true,
    }),
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { safetyPausedReason: true },
    }),
    db.domainSafetyPause.findMany({
      where: { userId, pausedReason: { not: null } },
      select: { domain: true, pausedReason: true, pausedAt: true },
      orderBy: { domain: "asc" },
    }),
    db.suppression.count({ where: { userId } }),
  ]);

  const recentIds = recentCampaigns.map((campaign) => campaign.id);
  const recentStates = recentIds.length
    ? await db.delivery.groupBy({
        by: ["campaignId", "state"],
        where: { userId, campaignId: { in: recentIds } },
        _count: true,
      })
    : [];

  const count = (state: string) =>
    deliveryStates.find((row) => row.state === state)?._count ?? 0;
  const attempted = deliveryStates.reduce(
    (total, row) =>
      total +
      (["PENDING", "QUEUED", "PROCESSING", "DEFERRED", "CANCELLED", "SUPPRESSED"].includes(
        row.state,
      )
        ? 0
        : row._count),
    0,
  );
  const delivered = count("DELIVERED");
  const hardBounces = count("HARD_BOUNCED");
  const complaints = count("COMPLAINED");
  const readyDomains = senderCatalog.domains.filter(
    (domain) =>
      domain.status === "VERIFIED" &&
      domain.senders.some(
        (sender) => sender.enabled && sender.availableProviderIds.length > 0,
      ),
  );
  const readySenders = readyDomains.flatMap((domain) =>
    domain.senders.filter(
      (sender) => sender.enabled && sender.availableProviderIds.length > 0,
    ),
  );
  const healthyProviders = providers.filter(
    (provider) => provider.enabled && provider.health === "HEALTHY",
  );
  const attentionProviders = providers.filter(
    (provider) =>
      provider.health !== "HEALTHY" ||
      !provider.enabled ||
      (provider.cooldownUntil &&
        provider.cooldownUntil.getTime() > now.getTime()),
  );

  const steps = [
    {
      key: "provider",
      title: "Connect a sending service",
      description: "Add Resend, Amazon SES, SendGrid, SMTP or another supported service.",
      complete: providers.length > 0,
      href: "/providers",
      action: providers.length ? "Review services" : "Connect service",
    },
    {
      key: "sender",
      title: "Verify a sending domain",
      description: "Confirm a domain and at least one usable From address.",
      complete: readySenders.length > 0,
      href: "/providers",
      action: readySenders.length ? "Review senders" : "Verify sender",
    },
    {
      key: "recipients",
      title: "Add recipients",
      description: "Upload a list or paste permission-based email addresses.",
      complete: savedLists > 0,
      href: "/blast",
      action: savedLists ? "View campaign" : "Add recipients",
    },
    {
      key: "campaign",
      title: "Create your first campaign",
      description: "Prepare, review and send through the production delivery pipeline.",
      complete: campaignCount > 0,
      href: "/blast",
      action: campaignCount ? "Create another" : "Create campaign",
    },
  ];

  return {
    periodStart: start.toISOString(),
    metrics: {
      delivered,
      attempted,
      hardBounces,
      complaints,
      bounceRate: attempted ? hardBounces / attempted : 0,
      complaintRate: attempted ? complaints / attempted : 0,
      savedLists,
      suppressions,
    },
    readiness: {
      complete: steps.every((step) => step.complete),
      completedSteps: steps.filter((step) => step.complete).length,
      totalSteps: steps.length,
      steps,
    },
    sending: {
      providers: providers.length,
      healthyProviders: healthyProviders.length,
      attentionProviders: attentionProviders.length,
      verifiedDomains: readyDomains.length,
      usableSenders: readySenders.length,
      accountPausedReason: user.safetyPausedReason,
      domainPauses,
    },
    recentCampaigns: recentCampaigns.map((campaign) => {
      const mine = recentStates.filter((row) => row.campaignId === campaign.id);
      const states = Object.fromEntries(
        mine.map((row) => [row.state, row._count]),
      );
      return {
        ...campaign,
        delivered: Number(states.DELIVERED ?? 0),
        bounced:
          Number(states.HARD_BOUNCED ?? 0) + Number(states.SOFT_BOUNCED ?? 0),
        failed: Number(states.FAILED ?? 0),
      };
    }),
  };
}
