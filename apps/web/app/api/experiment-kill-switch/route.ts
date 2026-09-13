import { z } from "zod";
import { requireUser, assertSameOrigin } from "@emailsystem/core/auth";
import { errorResponse, readJson, response } from "@emailsystem/core/http";
import {
  experimentKillSwitchStatus,
  setExperimentKillSwitch,
} from "@emailsystem/core/experiments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return response(await experimentKillSwitchStatus(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const input = z
      .object({
        engaged: z.boolean(),
        reason: z.string().max(300).optional(),
      })
      .strict()
      .parse(await readJson(request, 4096));
    return response(
      await setExperimentKillSwitch(user.id, input.engaged, input.reason),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
