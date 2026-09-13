import { z } from "zod";
import {
  assertSameOrigin,
  clearSessionCookieValue,
  login,
  sessionCookiePath,
  sessionCookieValue,
} from "@emailsystem/core/auth";
import { errorResponse, readJson } from "@emailsystem/core/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = z
      .object({ email: z.email(), password: z.string().min(1).max(256) })
      .strict()
      .parse(await readJson(request, 4096));
    const result = await login(
      input.email,
      input.password,
      request.headers.get("x-real-ip") ?? "direct",
    );
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookieValue(result.token));
    // Remove the legacy root-scoped cookie if an older deployment created one.
    // Duplicate cookies with the same name can make Safari choose a stale token.
    if (sessionCookiePath() !== "/")
      headers.append("Set-Cookie", clearSessionCookieValue("/"));
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
