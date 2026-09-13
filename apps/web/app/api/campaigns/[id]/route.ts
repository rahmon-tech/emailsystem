import { z } from "zod";
import { api as coreApi } from "@emailsystem/core/api";
import { archiveCampaign } from "@emailsystem/core/campaign-archive";
import { assertSameOrigin, requireUser } from "@emailsystem/core/auth";
import { errorResponse, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const id = (await params).id;
  return coreApi(request, ["campaigns", id]);
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    return response(await archiveCampaign(user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}
