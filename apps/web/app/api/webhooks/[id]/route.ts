import { receiveWebhook } from "@emailsystem/core/events";
import { readBounded, errorResponse, response } from "@emailsystem/core/http";
import { consumeLimit } from "@emailsystem/core/redis";
import { AppError } from "@emailsystem/core/errors";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = z.uuid().parse((await params).id);
    if (!(await consumeLimit(`webhook:${id}`, 3000, 60)))
      throw new AppError(429, "RATE", "Webhook rate limit reached.");
    const raw =
      request.method === "GET"
        ? "{}"
        : new TextDecoder().decode(await readBounded(request, 1048576));
    return response({
      received: await receiveWebhook(
        id,
        raw,
        request.headers,
        new URL(request.url),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as POST };
