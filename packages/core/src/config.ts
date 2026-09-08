import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  APP_URL: z.string().url(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  SESSION_SECRET: z.string().regex(/^[a-f0-9]{64}$/i),
  ALLOW_MOCK_PROVIDER: z.enum(["true", "false"]).default("false"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(7).default(90),
  ATTEMPT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
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
    if (
      cached.NODE_ENV === "production" &&
      !cached.APP_URL.startsWith("https://")
    )
      throw new Error("Production APP_URL must use HTTPS");
  }
  return cached;
}
