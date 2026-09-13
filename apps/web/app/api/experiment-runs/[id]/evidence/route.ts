import { z } from "zod";
import { requireUser } from "@emailsystem/core/auth";
import { errorResponse } from "@emailsystem/core/http";
import { exportExperimentEvidence } from "@emailsystem/core/experiment-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const evidence = await exportExperimentEvidence(user.id, id);
    return new Response(JSON.stringify(evidence), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="experiment-${id}-evidence.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
