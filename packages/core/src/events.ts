import { db } from "@emailsystem/db";
import {
  authenticateWebhook,
  normalizeWebhook,
} from "@emailsystem/providers/webhooks";
import type { NormalizedEvent } from "@emailsystem/providers/webhooks";
import { unlocked } from "./providers";
import { AppError } from "./errors";
import { lockCampaign } from "./campaigns";
import { deliveryAfterEvent } from "./domain";
import type { EventKind } from "./domain";
import { maskEmail, digest, verifySignedToken } from "./security";
import { config } from "./config";
export async function receiveWebhook(
  providerId: string,
  raw: string,
  headers: Headers,
  url: URL,
) {
  const row = await db.providerConnection.findUnique({
    where: { id: providerId },
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "Webhook not found.");
  const c = unlocked(row);
  if (!(await authenticateWebhook(c, raw, headers, url)))
    throw new AppError(401, "SIGNATURE", "Webhook authentication failed.");
  const payload =
    c.type === "elastic"
      ? Object.fromEntries(url.searchParams)
      : headers
            .get("content-type")
            ?.includes("application/x-www-form-urlencoded")
        ? Object.fromEntries(new URLSearchParams(raw))
        : JSON.parse(raw);
  const events = normalizeWebhook(
    c.type,
    payload,
    headers.get("svix-id") ?? digest(raw),
  );
  for (const event of events) await ingestEvent(row.id, event);
  return events.length;
}
export async function ingestEvent(providerId: string, event: NormalizedEvent) {
  // Store before matching: notifications can arrive before the send response is committed.
  const record = await db.providerEvent.upsert({
    where: { providerId_eventKey: { providerId, eventKey: event.eventKey } },
    create: {
      providerId,
      eventKey: event.eventKey,
      messageId: event.messageId,
      recipient: event.recipient,
      attemptId: event.attemptId,
      kind: event.kind,
      occurredAt: event.occurredAt,
    },
    update: {},
  });
  await applyEvent(record.id);
}
export async function applyEvent(id: string) {
  const event = await db.providerEvent.findUnique({
    where: { id },
    include: { provider: true },
  });
  if (!event || event.processed) return;
  const attempt = await db.deliveryAttempt.findFirst({
    where: {
      providerId: event.providerId,
      userId: event.provider.userId,
      OR: [
        { providerMessageId: event.messageId },
        ...(event.attemptId ? [{ id: event.attemptId }] : []),
      ],
    },
    include: { delivery: { include: { campaign: true } } },
  });
  if (!attempt) {
    await db.providerEvent.update({
      where: { id },
      data: { nextMatchAt: new Date(Date.now() + 60000) },
    });
    return;
  }
  if (event.recipient && event.recipient !== attempt.delivery.email) {
    const copies = attempt.delivery.campaign.message as unknown as {
      cc: string[];
      bcc: string[];
    };
    if (
      [...copies.cc, ...copies.bcc].includes(event.recipient) &&
      ["hard_bounce", "complaint", "unsubscribe"].includes(event.kind)
    )
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${attempt.userId + ":" + event.recipient},0))::text`;
        await tx.suppression.upsert({
          where: {
            userId_email: { userId: attempt.userId, email: event.recipient! },
          },
          create: {
            userId: attempt.userId,
            email: event.recipient!,
            reason: event.kind,
          },
          update: { reason: event.kind },
        });
      });
    await db.providerEvent.update({ where: { id }, data: { processed: true } });
    return;
  }
  await db.$transaction(async (tx) => {
    await lockCampaign(tx, attempt.delivery.campaignId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${attempt.userId + ":" + attempt.delivery.email},0))::text`;
    const claimed = await tx.providerEvent.updateMany({
      where: { id, processed: false },
      data: { processed: true },
    });
    if (!claimed.count) return;
    const delivery = await tx.delivery.findUniqueOrThrow({
      where: { id: attempt.deliveryId },
    });
    const state = deliveryAfterEvent(delivery.state, event.kind as EventKind);
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        state,
        ...(state === "DELIVERED"
          ? {
              deliveredAt: event.occurredAt,
              acceptedAt: delivery.acceptedAt ?? event.occurredAt,
            }
          : {}),
        ...(state === "PROVIDER_ACCEPTED"
          ? { acceptedAt: delivery.acceptedAt ?? event.occurredAt }
          : {}),
      },
    });
    if (["accepted", "delivered"].includes(event.kind))
      await tx.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          state: "ACCEPTED",
          providerMessageId: event.messageId,
          finishedAt: attempt.finishedAt ?? new Date(),
        },
      });
    if (["hard_bounce", "complaint", "unsubscribe"].includes(event.kind))
      await tx.suppression.upsert({
        where: {
          userId_email: { userId: attempt.userId, email: delivery.email },
        },
        create: {
          userId: attempt.userId,
          email: delivery.email,
          reason: event.kind,
        },
        update: { reason: event.kind },
      });
    if (["hard_bounce", "complaint", "soft_bounce"].includes(event.kind))
      await tx.campaign.updateMany({
        where: { id: delivery.campaignId, state: "COMPLETED" },
        data: { state: "COMPLETED_WITH_ERRORS" },
      });
    await tx.activityEvent.create({
      data: {
        userId: attempt.userId,
        campaignId: delivery.campaignId,
        deliveryId: delivery.id,
        providerName: event.provider.name,
        maskedEmail: maskEmail(delivery.email),
        kind: event.kind.toUpperCase(),
        message: `Provider reported ${event.kind.replaceAll("_", " ")}.`,
      },
    });
  });
}
export async function reconcileEvents() {
  const events = await db.providerEvent.findMany({
    where: { processed: false, nextMatchAt: { lte: new Date() } },
    take: 100,
    orderBy: { nextMatchAt: "asc" },
  });
  for (const event of events) await applyEvent(event.id);
}
export async function unsubscribe(token: string) {
  if (!verifySignedToken(token, config().SESSION_SECRET))
    throw new AppError(404, "TOKEN", "Unsubscribe link is invalid.");
  const d = await db.delivery.findUnique({
    where: { unsubscribeHash: digest(token) },
  });
  if (!d) throw new AppError(404, "TOKEN", "Unsubscribe link is invalid.");
  await db.$transaction(async (tx) => {
    await lockCampaign(tx, d.campaignId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${d.userId + ":" + d.email},0))::text`;
    await tx.suppression.upsert({
      where: { userId_email: { userId: d.userId, email: d.email } },
      create: { userId: d.userId, email: d.email, reason: "unsubscribe" },
      update: { reason: "unsubscribe" },
    });
    await tx.delivery.updateMany({
      where: {
        userId: d.userId,
        email: d.email,
        state: { in: ["PENDING", "QUEUED", "DEFERRED"] },
      },
      data: { state: "SUPPRESSED" },
    });
    await tx.activityEvent.create({
      data: {
        userId: d.userId,
        campaignId: d.campaignId,
        deliveryId: d.id,
        maskedEmail: maskEmail(d.email),
        kind: "UNSUBSCRIBED",
        message: "Recipient unsubscribed. Future messages are suppressed.",
      },
    });
  });
}
