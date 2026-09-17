import { z } from "zod";
import { db } from "@emailsystem/db";
import { requireUser } from "@emailsystem/core/auth";
import { getExperimentEvidenceReview } from "@emailsystem/core/experiment-evidence-review";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const verify = new URL(request.url).searchParams.get("verify") === "1";
    const campaign = await db.campaign.findFirst({
      where: { id, userId: user.id },
      select: { experimentRunId: true },
    });
    if (!campaign)
      return response(
        { error: "Campaign not found.", code: "NOT_FOUND" },
        404,
      );
    if (!campaign.experimentRunId)
      return response({ runId: null, evidence: null });

    return response({
      runId: campaign.experimentRunId,
      evidence: await getExperimentEvidenceReview(
        user.id,
        campaign.experimentRunId,
        { verify },
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
