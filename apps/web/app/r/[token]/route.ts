import { redirectVisit } from "@emailsystem/core/tracking";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    return await redirectVisit(request, (await context.params).token);
  } catch {
    return new Response("This link is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
export const HEAD = GET;
