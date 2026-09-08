import { api } from "@emailsystem/core/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return api(request, (await params).path);
}
export { handler as GET, handler as POST, handler as PUT };
