import { z } from "zod";
import { db } from "@emailsystem/db";
import { requireUser } from "@emailsystem/core/auth";
import { AppError } from "@emailsystem/core/errors";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const campaign = await db.campaign.findFirst({
      where: { id, userId: user.id },
      select: {
        experimentRun: {
          select: {
            id: true,
            state: true,
            authorizationRef: true,
            maxRecipients: true,
            maxAttempts: true,
            recipientsUsed: true,
            attemptsUsed: true,
            startedAt: true,
            expiresAt: true,
            stoppedAt: true,
            stopReason: true,
            profile: { select: { name: true } },
          },
        },
      },
    });
    if (!campaign)
      throw new AppError(404, "NOT_FOUND", "Campaign not found.");
    return response(campaign.experimentRun);
  } catch (error) {
    return errorResponse(error);
  }
}
