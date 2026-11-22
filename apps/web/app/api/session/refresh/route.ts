import {
  assertSameOrigin,
  clearSessionCookieValue,
  cookieTokens,
  refreshFirstSession,
  sessionCookiePath,
  sessionCookieValue,
} from "@emailsystem/core/auth";
import { errorResponse } from "@emailsystem/core/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const refreshed = await refreshFirstSession(cookieTokens(request));
    if (!refreshed)
      return Response.json(
        { error: "Please sign in.", code: "UNAUTHENTICATED" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookieValue(refreshed.token));
    if (sessionCookiePath() !== "/")
      headers.append("Set-Cookie", clearSessionCookieValue("/"));
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
