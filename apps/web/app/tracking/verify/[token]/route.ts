import { db } from "@emailsystem/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const domain = /^[\w-]{43}$/.test(token)
    ? await db.trackingDomain.findUnique({
        where: { proofToken: token },
        select: { hostname: true },
      })
    : null;
  if (!domain || request.headers.get("host")?.toLowerCase() !== domain.hostname)
    return new Response("Not found", { status: 404 });
  return new Response(`emailblast:${token}`, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
