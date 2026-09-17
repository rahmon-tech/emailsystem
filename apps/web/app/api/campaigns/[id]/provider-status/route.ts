import { z } from "zod";
import { requireUser } from "@emailsystem/core/auth";
import { campaignProviderStatus } from "@emailsystem/core/campaign-provider-status";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    return response(await campaignProviderStatus(user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}
