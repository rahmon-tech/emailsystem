import { z } from "zod";
import { db, type Prisma } from "@emailsystem/db";
import { opaqueToken } from "./security";
import { config } from "./config";
import { isDeniedDomain } from "./reputation";
import { destination, emailLinks, mapEmailLinks } from "@emailsystem/email";
import { absoluteAppUrl } from "./server-paths";

export const trackingSettings = z
  .object({
    defaultEnabled: z.boolean().default(false),
    blockUnknown: z.boolean().default(false),
  })
  .strict();

export async function getTracking(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trackingSettings: true },
  });
  return {
    settings: trackingSettings.parse(user.trackingSettings),
    appUrl: config().APP_URL,
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
  await db.user.update({
    where: { id: userId },
    data: { trackingSettings: settings },
  });
  return settings;
}

export async function trackingChoice(
  userId: string,
  input?: { enabled: boolean },
) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trackingSettings: true },
  });
  const settings = trackingSettings.parse(user.trackingSettings);
  return {
    enabled: input ? input.enabled : settings.defaultEnabled,
    settings,
    problem: null,
  };
}

export async function createTrackedSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
  html: string,
  enabled: boolean,
) {
  if (!enabled) return html;
  const app = new URL(config().APP_URL);
  const redirectPrefix = `${app.pathname.replace(/\/$/, "")}/r/`;
  const replacements = new Map<string, string>();
  for (const href of emailLinks(html)) {
    if (replacements.has(href)) continue;
    const url = destination(href);
    if (
      !url ||
      (url.origin === app.origin && url.pathname.startsWith(redirectPrefix)) ||
      /(?:^|\/)(?:unsubscribe|opt-out)(?:\/|$)/i.test(url.pathname)
    )
      continue;
    const token = opaqueToken();
    await tx.trackingLink.create({
      data: {
        userId,
        campaignId,
        token,
        destination: url.href,
        expiresAt: new Date(
          Date.now() + config().TRACKING_LINK_LIFETIME_DAYS * 86400000,
        ),
      },
    });
    replacements.set(href, absoluteAppUrl(`/r/${token}`));
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
  const canonical = new URL(config().APP_URL);
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.toLowerCase();
  const redirectPath = `${canonical.pathname.replace(/\/$/, "")}/r/${token}`;
  if (
    host !== canonical.host.toLowerCase() ||
    requestUrl.pathname !== redirectPath
  )
    return gone();
  // Never accept a destination from the request, query string or headers.
  const link = await db.trackingLink.findUnique({ where: { token } });
  if (!link || link.expiresAt <= new Date()) return gone();
  const url = destination(link.destination);
  if (!url) return gone();
  const denied = await db.deniedDestination.findMany({
    where: { userId: link.userId },
    select: { hostname: true },
  });
  if (
    isDeniedDomain(
      url.hostname,
      denied.map((item) => item.hostname),
    )
  )
    return gone();
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const automated = likelyAutomated(request) ? 1 : 0;
  // Aggregate only: no recipient, IP, user agent, cookie, fingerprint or headers.
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
  const rawVisits = result._sum.rawVisits ?? 0;
  const automated = result._sum.likelyAutomated ?? 0;
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
