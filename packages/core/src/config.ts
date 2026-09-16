import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  APP_URL: z.string().url(),
  NEXT_PUBLIC_BASE_PATH: z
    .string()
    .regex(/^(?:\/[a-zA-Z0-9_-]+)*$/)
    .default(""),
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  SESSION_SECRET: z.string().regex(/^[a-f0-9]{64}$/i),
  ALLOW_MOCK_PROVIDER: z.enum(["true", "false"]).default("false"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(7).default(90),
  ATTEMPT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
  WEBHOOK_RETENTION_DAYS: z.coerce.number().int().min(7).default(30),
  EXPERIMENT_EVIDENCE_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3650)
    .default(365),
  EXPERIMENT_MESSAGE_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30),
  CLICK_ANALYTICS_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(90),
  TRACKING_LINK_LIFETIME_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(730)
    .default(180),
  MAX_IMPORT_ROWS: z.coerce.number().int().min(1).max(1000000).default(100000),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(25000000)
    .default(10000000),
});
let cached: z.infer<typeof schema> | undefined;
export function config() {
  if (!cached) {
    cached = schema.parse(process.env);
    const appUrl = new URL(cached.APP_URL);
    if (
      appUrl.username ||
      appUrl.password ||
      appUrl.search ||
      appUrl.hash ||
      appUrl.pathname.replace(/\/$/, "") !== cached.NEXT_PUBLIC_BASE_PATH
    )
      throw new Error(
        "APP_URL path must match NEXT_PUBLIC_BASE_PATH, without credentials, query or fragment",
      );
    cached.APP_URL = cached.APP_URL.replace(/\/$/, "");
    if (
      cached.NODE_ENV === "production" &&
      !cached.APP_URL.startsWith("https://")
    )
      throw new Error("Production APP_URL must use HTTPS");
  }
  return cached;
}
