import { z } from "zod";
import { db } from "@emailsystem/db";
import { requireUser } from "@emailsystem/core/auth";
import { deriveCampaignPacing } from "@emailsystem/core/campaign-pacing";
import { AppError } from "@emailsystem/core/errors";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OBSERVATION_WINDOW_MS = 5 * 60_000;
const remainingStates = ["PENDING", "QUEUED", "PROCESSING", "DEFERRED"] as const;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const campaign = await db.campaign.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        state: true,
        safetyWaitUntil: true,
        safetyWaitReason: true,
      },
    });
    if (!campaign)
      throw new AppError(404, "NOT_FOUND", "Campaign not found.");

    const now = Date.now();
    const [attempts, remaining] = await Promise.all([
      db.deliveryAttempt.findMany({
        where: {
          userId: user.id,
          delivery: { campaignId: id },
          transmissionStartedAt: {
            gte: new Date(now - OBSERVATION_WINDOW_MS),
            lte: new Date(now),
          },
        },
        select: { transmissionStartedAt: true },
        orderBy: { transmissionStartedAt: "desc" },
        take: 120,
      }),
      db.delivery.count({
        where: {
          userId: user.id,
          campaignId: id,
          state: { in: [...remainingStates] },
        },
      }),
    ]);

    const pacing = deriveCampaignPacing(
      attempts.flatMap((attempt) =>
        attempt.transmissionStartedAt ? [attempt.transmissionStartedAt] : [],
      ),
      remaining,
      now,
    );
    return response({
      ...pacing,
      campaignState: campaign.state,
      safetyWaitUntil: campaign.safetyWaitUntil,
      safetyWaitReason: campaign.safetyWaitReason,
      observedWindowSeconds: OBSERVATION_WINDOW_MS / 1000,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
