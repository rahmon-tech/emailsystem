export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(409, "CONFLICT", message);
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogScalar = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogScalar>;

const sensitiveField =
  /(authorization|cookie|password|secret|token|credential|api.?key|recipient|email)/i;
const reservedField = /^(time|level|event|error)$/;

export function redactLogText(value: string) {
  return value
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:token|secret|password|api[_-]?key|signature|credential)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/[^/\s:@]+:)[^@\s/]+@/gi, "$1[redacted]@")
    .slice(0, 1000);
}

function safeFields(fields: LogFields) {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || reservedField.test(key)) continue;
    if (sensitiveField.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = typeof value === "string" ? redactLogText(value) : value;
  }
  return result;
}

export function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const code =
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
      ? error.code
      : undefined;
  return {
    name: error.name || "Error",
    ...(code === undefined ? {} : { code }),
    message: redactLogText(error.message || "Unexpected error"),
  };
}

export function newCorrelationId(candidate?: unknown) {
  if (
    typeof candidate === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(candidate)
  )
    return candidate;
  return crypto.randomUUID();
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  error?: unknown,
) {
  const record = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event: redactLogText(event),
    ...safeFields(fields),
    ...(error === undefined ? {} : { error: serializeError(error) }),
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

// Backward-compatible helper for existing event-only instrumentation.
export function log(event: string, fields: LogFields = {}) {
  logEvent("info", event, fields);
}
