import { requireUser, assertSameOrigin } from "@emailsystem/core/auth";
import { errorResponse, readJson, response } from "@emailsystem/core/http";
import { listExperimentProfiles } from "@emailsystem/core/experiments";
import { createExperimentProfileAtomic } from "@emailsystem/core/experiment-profile-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return response(await listExperimentProfiles(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    return response(
      await createExperimentProfileAtomic(
        user.id,
        await readJson(request, 512_000),
      ),
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
