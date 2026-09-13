import { z } from "zod";
import { requireUser, assertSameOrigin } from "@emailsystem/core/auth";
import { errorResponse, readJson, response } from "@emailsystem/core/http";
import {
  createExperimentRun,
  listExperimentRuns,
} from "@emailsystem/core/experiments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return response(await listExperimentRuns(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const input = z
      .object({ profileId: z.uuid() })
      .strict()
      .parse(await readJson(request, 4096));
    return response(await createExperimentRun(user.id, input.profileId), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
