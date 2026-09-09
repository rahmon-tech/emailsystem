import { z } from "zod";
import { db, type Prisma, type TrackingDomain } from "@emailsystem/db";
import { opaqueToken } from "./security";
import { config } from "./config";
import { AppError } from "./errors";
import { canonicalDomain, isDeniedDomain } from "./reputation";
import { destination, emailLinks, mapEmailLinks } from "@emailsystem/email";
import { verifyTrackingHost } from "./tracking-verification";

export const trackingSettings = z
  .object({
    defaultEnabled: z.boolean().default(false),
    defaultDomainId: z.uuid().nullable().default(null),
    blockUnknown: z.boolean().default(false),
  })
  .strict();
export const usableDomain = (
  d: Pick<TrackingDomain, "enabled" | "verifiedUntil">,
  now = new Date(),
) => d.enabled && !!d.verifiedUntil && d.verifiedUntil > now;
export const trackingBasePath = () =>
  new URL(config().APP_URL).pathname.replace(/\/$/, "");
export async function getTracking(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trackingSettings: true },
  });
  const domains = await db.trackingDomain.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return {
    settings: trackingSettings.parse(user.trackingSettings),
    domains: domains.map((d) => ({
      ...d,
      usable: usableDomain(d),
      txtName: `_emailblast.${d.hostname}`,
      txtValue: `emailblast-verification=${d.proofToken}`,
    })),
    deniedDomains: await db.deniedDestination.findMany({
      where: { userId },
      select: { id: true, hostname: true },
      orderBy: { hostname: "asc" },
    }),
    retentionDays: config().CLICK_ANALYTICS_RETENTION_DAYS,
    linkLifetimeDays: config().TRACKING_LINK_LIFETIME_DAYS,
  };
}
export async function saveTrackingSettings(userId: string, input: unknown) {
  const settings = trackingSettings.parse(input);
  if (
    settings.defaultEnabled &&
    (!settings.defaultDomainId ||
      !(await db.trackingDomain.findFirst({
        where: {
          id: settings.defaultDomainId,
          userId,
          enabled: true,
          verifiedUntil: { gt: new Date() },
        },
      })))
  )
    throw new AppError(
      422,
      "TRACKING_DOMAIN",
      "Verify and select a tracking hostname before enabling the default.",
    );
  await db.user.update({
    where: { id: userId },
    data: { trackingSettings: settings },
  });
  return settings;
}
export async function addTrackingDomain(userId: string, input: unknown) {
  const data = z
    .object({ hostname: z.string().max(253) })
    .strict()
    .parse(input);
  let hostname: string;
  try {
    hostname = canonicalDomain(data.hostname);
  } catch {
    throw new AppError(
      400,
      "HOSTNAME",
      "Enter a valid hostname without a protocol or path.",
    );
  }
  if (/\.(localhost|local|internal|invalid|test)$/.test(hostname))
    throw new AppError(400, "HOSTNAME", "Use a public hostname that you own.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    if ((await tx.trackingDomain.count({ where: { userId } })) >= 20)
      throw new AppError(
        422,
        "DOMAIN_LIMIT",
        "Use at most 20 tracking hostnames.",
      );
    if (await tx.trackingDomain.findUnique({ where: { hostname } }))
      throw new AppError(
        409,
        "HOSTNAME",
        "This hostname is already registered.",
      );
    return tx.trackingDomain.create({
      data: { userId, hostname, proofToken: opaqueToken() },
    });
  });
}
export async function verifyDomain(
  userId: string,
  id: string,
  verifier = verifyTrackingHost,
) {
  const domain = await db.trackingDomain.findFirst({ where: { id, userId } });
  if (!domain)
    throw new AppError(404, "NOT_FOUND", "Tracking hostname not found.");
  const ok = await verifier(
    domain.hostname,
    domain.proofToken,
    trackingBasePath(),
  ).catch(() => false);
  const now = new Date();
  const changed = await db.trackingDomain.updateMany({
    where: { id, userId, revision: domain.revision },
    data: {
      revision: { increment: 1 },
      lastCheckedAt: now,
      ...(ok
        ? {
            verifiedAt: now,
            verifiedUntil: new Date(now.getTime() + 30 * 86400000),
            enabled: true,
          }
        : {}),
    },
  });
  if (!changed.count)
    throw new AppError(
      409,
      "DOMAIN_CHANGED",
      "Hostname settings changed. Try verification again.",
    );
  if (!ok)
    throw new AppError(
      422,
      "DOMAIN_VERIFICATION",
      "Verification failed. Check the TXT record, HTTPS certificate, and routing to this app.",
    );
  return { verified: true };
}
export async function disableDomain(userId: string, id: string) {
  const result = await db.trackingDomain.updateMany({
    where: { id, userId },
    data: { enabled: false, verifiedUntil: null, revision: { increment: 1 } },
  });
  if (!result.count)
    throw new AppError(404, "NOT_FOUND", "Tracking hostname not found.");
  return { disabled: true };
}
export async function trackingChoice(
  userId: string,
  input?: { enabled: boolean; domainId?: string },
) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trackingSettings: true },
  });
  const settings = trackingSettings.parse(user.trackingSettings);
  const requested = input ? input.enabled : settings.defaultEnabled;
  const id = input?.domainId ?? settings.defaultDomainId;
  const domain =
    requested && id
      ? await db.trackingDomain.findFirst({
          where: {
            id,
            userId,
            enabled: true,
            verifiedUntil: { gt: new Date() },
          },
        })
      : null;
  // A stale account default must never make direct sending impossible.
  const problem =
    input?.enabled && !domain
      ? "Select a verified tracking hostname, or switch click tracking off."
      : null;
  return { enabled: requested && !!domain, domain, settings, problem };
}

export async function createTrackedSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
  html: string,
  domain: TrackingDomain | null,
) {
  if (!domain) return html;
  const current = await tx.trackingDomain.findFirst({
    where: {
      id: domain.id,
      userId,
      enabled: true,
      verifiedUntil: { gt: new Date() },
    },
  });
  if (!current)
    throw new AppError(
      409,
      "TRACKING_DOMAIN",
      "Tracking hostname changed. Run pre-flight again or switch tracking off.",
    );
  const replacements = new Map<string, string>();
  const ownHosts = (
    await tx.trackingDomain.findMany({
      where: { userId },
      select: { hostname: true },
    })
  ).map((d) => d.hostname);
  for (const href of emailLinks(html)) {
    const url = destination(href);
    if (
      !url ||
      ownHosts.includes(url.hostname) ||
      /(?:^|\/)(?:unsubscribe|opt-out)(?:\/|$)/i.test(url.pathname)
    )
      continue;
    const token = opaqueToken();
    await tx.trackingLink.create({
      data: {
        userId,
        campaignId,
        domainId: current.id,
        token,
        destination: url.href,
        expiresAt: new Date(
          Date.now() + config().TRACKING_LINK_LIFETIME_DAYS * 86400000,
        ),
      },
    });
    replacements.set(
      href,
      `https://${current.hostname}${trackingBasePath()}/r/${token}`,
    );
  }
  return mapEmailLinks(html, (href) => replacements.get(href) ?? href);
}

export function likelyAutomated(request: Request) {
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 512);
  return (
    request.method === "HEAD" ||
    /bot|crawler|spider|scanner|proofpoint|barracuda|mimecast|safelinks|urlscan|headless/i.test(
      ua,
    ) ||
    /prefetch|prerender/i.test(
      (request.headers.get("purpose") ?? "") +
        (request.headers.get("sec-purpose") ?? ""),
    )
  );
}
export async function redirectVisit(request: Request, token: string) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  };
  const gone = () =>
    new Response("This link is unavailable.", { status: 410, headers });
  if (!/^[\w-]{43}$/.test(token) || !["GET", "HEAD"].includes(request.method))
    return gone();
  // Never accept a destination from a query string or request header.
  const link = await db.trackingLink.findUnique({
    where: { token },
    include: { domain: true },
  });
  const host = request.headers.get("host")?.toLowerCase();
  if (
    !link ||
    link.domain.userId !== link.userId ||
    host !== link.domain.hostname ||
    !usableDomain(link.domain) ||
    link.expiresAt <= new Date()
  )
    return gone();
  const url = destination(link.destination);
  if (!url) return gone();
  const denied = await db.deniedDestination.findMany({
    where: { userId: link.userId },
    select: { hostname: true },
  });
  if (
    isDeniedDomain(
      url.hostname,
      denied.map((d) => d.hostname),
    )
  )
    return gone();
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const automated = likelyAutomated(request) ? 1 : 0;
  // Aggregate only: no recipient identity, IP, UA, cookies or headers stored.
  // An analytics failure cannot turn a valid redirect into a failed click.
  await db.trackingVisitDay
    .upsert({
      where: { linkId_day: { linkId: link.id, day } },
      create: {
        linkId: link.id,
        userId: link.userId,
        day,
        rawVisits: 1,
        likelyAutomated: automated,
      },
      update: {
        rawVisits: { increment: 1 },
        likelyAutomated: { increment: automated },
      },
    })
    .catch(() => undefined);
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: url.href },
  });
}
export async function trackingSummary(userId: string, campaignId: string) {
  const result = await db.trackingVisitDay.aggregate({
    where: { userId, link: { userId, campaignId } },
    _sum: { rawVisits: true, likelyAutomated: true },
  });
  const rawVisits = result._sum.rawVisits ?? 0,
    automated = result._sum.likelyAutomated ?? 0;
  return {
    rawVisits,
    likelyAutomated: automated,
    unclassified: rawVisits - automated,
    retentionDays: config().CLICK_ANALYTICS_RETENTION_DAYS,
  };
}
export async function retainTracking(now = new Date()) {
  await db.trackingVisitDay.deleteMany({
    where: {
      day: {
        lt: new Date(
          now.getTime() - config().CLICK_ANALYTICS_RETENTION_DAYS * 86400000,
        ),
      },
    },
  });
  await db.trackingLink.deleteMany({ where: { expiresAt: { lte: now } } });
}
