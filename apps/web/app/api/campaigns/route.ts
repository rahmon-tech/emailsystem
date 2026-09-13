import { z } from "zod";
import { api as coreApi } from "@emailsystem/core/api";
import { requireUser } from "@emailsystem/core/auth";
import { listVisibleCampaigns } from "@emailsystem/core/campaign-archive";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const cursor = new URL(request.url).searchParams.get("cursor");
    const parsedCursor = cursor ? z.uuid().parse(cursor) : undefined;
    return response(await listVisibleCampaigns(user.id, parsedCursor));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  return coreApi(request, ["campaigns"]);
}
