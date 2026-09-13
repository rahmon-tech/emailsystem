import { z } from "zod";
import { requireUser, assertSameOrigin } from "@emailsystem/core/auth";
import { errorResponse, readJson, response } from "@emailsystem/core/http";
import {
  startExperimentRun,
  stopExperimentRun,
} from "@emailsystem/core/experiments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const input = z
      .object({
        action: z.enum(["start", "stop"]),
        reason: z.string().max(300).optional(),
      })
      .strict()
      .parse(await readJson(request, 4096));
    return response(
      input.action === "start"
        ? await startExperimentRun(user.id, id)
        : await stopExperimentRun(user.id, id, input.reason),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
