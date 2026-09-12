import {
  cookieToken,
  refreshSession,
  sessionCookie,
  sessionMaxAgeSeconds,
} from "@emailsystem/core/auth";
import { config } from "@emailsystem/core/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = cookieToken(request);
  const refreshed = await refreshSession(token);
  if (!refreshed)
    return Response.json(
      { error: "Please sign in.", code: "UNAUTHENTICATED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=${config().NEXT_PUBLIC_BASE_PATH || "/"}; Max-Age=${sessionMaxAgeSeconds}${config().NODE_ENV === "production" ? "; Secure" : ""}`,
        "Cache-Control": "no-store",
      },
    },
  );
}
