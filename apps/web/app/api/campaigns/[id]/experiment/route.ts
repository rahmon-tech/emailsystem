import { z } from "zod";
import { db } from "@emailsystem/db";
import { requireUser } from "@emailsystem/core/auth";
import { experimentVariables } from "@emailsystem/core/experiments";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const campaign = await db.campaign.findFirst({
      where: { id, userId: user.id },
      select: {
        experimentRun: {
          select: {
            id: true,
            profileVersion: true,
            authorizationRef: true,
            state: true,
            maxRecipients: true,
            maxAttempts: true,
            maxDurationSeconds: true,
            recipientsUsed: true,
            attemptsUsed: true,
            startsAt: true,
            expiresAt: true,
            startedAt: true,
            stoppedAt: true,
            killSwitchAt: true,
            stopReason: true,
            profile: { select: { name: true, variables: true } },
          },
        },
      },
    });
    if (!campaign)
      return response(
        { error: "Campaign not found.", code: "NOT_FOUND" },
        404,
      );

    const experiment = campaign.experimentRun
      ? {
          ...campaign.experimentRun,
          profile: {
            name: campaign.experimentRun.profile.name,
            variables: experimentVariables.parse(
              campaign.experimentRun.profile.variables,
            ),
          },
        }
      : null;
    return response({ experiment });
  } catch (error) {
    return errorResponse(error);
  }
}
