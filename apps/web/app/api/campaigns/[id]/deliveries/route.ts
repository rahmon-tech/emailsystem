import { z } from "zod";
import { db } from "@emailsystem/db";
import { definition } from "@emailsystem/providers";
import { campaignSummary } from "@emailsystem/core/campaigns";
import { recipientDeliveryPresentationState } from "@emailsystem/core/delivery-presentation";
import { requireUser } from "@emailsystem/core/auth";
import { AppError } from "@emailsystem/core/errors";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const deliveryState = z.enum([
  "PENDING",
  "QUEUED",
  "PROCESSING",
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "DEFERRED",
  "SOFT_BOUNCED",
  "HARD_BOUNCED",
  "FAILED",
  "COMPLAINED",
  "UNSUBSCRIBED",
  "SUPPRESSED",
  "CANCELLED",
  "UNKNOWN",
]);

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    await campaignSummary(user.id, id);

    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const cursor = url.searchParams.get("cursor");
    const parsedCursor = cursor ? z.uuid().parse(cursor) : undefined;

    if (
      parsedCursor &&
      !(await db.delivery.findFirst({
        where: { id: parsedCursor, userId: user.id, campaignId: id },
        select: { id: true },
      }))
    )
      throw new AppError(400, "CURSOR", "Invalid page cursor.");

    const rows = await db.delivery.findMany({
      where: {
        campaignId: id,
        userId: user.id,
        ...(state ? { state: deliveryState.parse(state) } : {}),
      },
      select: {
        id: true,
        email: true,
        state: true,
        attemptCount: true,
        acceptedAt: true,
        deliveredAt: true,
        safeError: true,
        attempts: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            provider: {
              select: {
                name: true,
                type: true,
                transport: true,
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 51,
      ...(parsedCursor ? { cursor: { id: parsedCursor }, skip: 1 } : {}),
    });

    return response({
      items: rows.slice(0, 50).map(({ attempts, ...delivery }) => {
        const provider = attempts[0]?.provider;
        const deliveryEvents = provider
          ? definition(provider.type as Parameters<typeof definition>[0])
              .webhook === "none"
            ? "unavailable"
            : "supported"
          : "unavailable";
        const providerContext = provider
          ? { transport: provider.transport, deliveryEvents }
          : null;
        return {
          ...delivery,
          state: recipientDeliveryPresentationState(
            delivery.state,
            providerContext,
          ),
          provider: provider ? { ...provider, deliveryEvents } : null,
        };
      }),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
