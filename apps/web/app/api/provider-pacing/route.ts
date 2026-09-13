import { db } from "@emailsystem/db";
import { requireUser } from "@emailsystem/core/auth";
import { errorResponse, response } from "@emailsystem/core/http";
import { providerPacingTelemetry } from "@emailsystem/core/provider-pacing-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const providers = await db.providerConnection.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        health: true,
        enabled: true,
        perMinute: true,
        cooldownUntil: true,
      },
    });
    return response(await providerPacingTelemetry(user.id, providers));
  } catch (error) {
    return errorResponse(error);
  }
}
