import { unsubscribe } from "@emailsystem/core/events";
import { errorResponse } from "@emailsystem/core/http";
export const runtime = "nodejs";
const html = (body: string) =>
  new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email preferences</title><body style="font:18px system-ui;max-width:520px;margin:12vh auto;padding:24px">${body}</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
export async function GET() {
  return html(
    '<h1>Unsubscribe</h1><p>Stop future emails from this sender.</p><form method="post"><button style="font:inherit;padding:12px 20px" type="submit">Unsubscribe</button></form>',
  );
}
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    await unsubscribe((await params).token);
    return html(
      "<h1>You’re unsubscribed.</h1><p>Your preference has been saved.</p>",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
