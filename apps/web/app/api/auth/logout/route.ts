import {
  assertSameOrigin,
  clearSessionCookieValue,
  cookieTokens,
  logoutTokens,
  sessionCookiePath,
} from "@emailsystem/core/auth";
import { errorResponse } from "@emailsystem/core/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await logoutTokens(cookieTokens(request));
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clearSessionCookieValue());
    if (sessionCookiePath() !== "/")
      headers.append("Set-Cookie", clearSessionCookieValue("/"));
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
