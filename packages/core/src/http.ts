import { ZodError } from "zod";
import { AppError, logEvent, newCorrelationId } from "./errors";

export function response(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(error: unknown) {
  const correlationId = newCorrelationId();
  const headers = { "X-Correlation-ID": correlationId };

  if (error instanceof AppError) {
    if (error.status >= 500)
      logEvent(
        "error",
        "http.app_error",
        { correlationId, code: error.code, status: error.status },
        error,
      );
    return response(
      { error: error.message, code: error.code },
      error.status,
      headers,
    );
  }
  if (error instanceof ZodError)
    return response(
      {
        error: "Check the highlighted fields.",
        code: "VALIDATION",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
      headers,
    );

  logEvent("error", "http.internal_error", { correlationId }, error);
  return response(
    {
      error: "The request could not be completed. Please try again.",
      code: "INTERNAL",
      supportRef: correlationId,
    },
    500,
    headers,
  );
}

export async function readBounded(request: Request, max: number) {
  if (Number(request.headers.get("content-length") ?? 0) > max)
    throw new AppError(413, "SIZE", "Request exceeds the size limit.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > max) {
        await reader.cancel();
        throw new AppError(413, "SIZE", "Request exceeds the size limit.");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function readJson(
  request: Request,
  max = 8000000,
): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(await readBounded(request, max)),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "JSON", "Invalid JSON request.");
  }
}
