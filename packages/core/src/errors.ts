export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
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
export function log(
  event: string,
  ids: Record<string, string | number | boolean | undefined> = {},
) {
  console.log(
    JSON.stringify({ time: new Date().toISOString(), event, ...ids }),
  );
}
