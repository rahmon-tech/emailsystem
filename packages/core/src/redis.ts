import { Redis } from "ioredis";
const globalRedis = globalThis as unknown as { emailRedis?: Redis };
export const redis =
  globalRedis.emailRedis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 5000,
    connectTimeout: 5000,
    enableOfflineQueue: true,
  });
if (process.env.NODE_ENV !== "production") globalRedis.emailRedis = redis;
export async function consumeLimit(key: string, max: number, seconds: number) {
  const result = await redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
    1,
    key,
    String(seconds),
  );
  return Number(result) <= max;
}
