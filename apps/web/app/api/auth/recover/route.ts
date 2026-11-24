import { z } from "zod";
import { assertSameOrigin } from "@emailsystem/core/auth";
import { recoverWithAdminCode } from "@emailsystem/core/account-recovery";
import { errorResponse, readJson, response } from "@emailsystem/core/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = z
      .object({
        email: z.email().max(254),
        code: z.string().min(1).max(256),
        newPassword: z.string().min(12).max(256),
      })
      .strict()
      .parse(await readJson(request, 4096));

    await recoverWithAdminCode(
      input.email,
      input.code,
      input.newPassword,
      request.headers.get("x-real-ip") ?? "direct",
    );
    return response({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
