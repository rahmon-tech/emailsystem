import { redis } from "@emailsystem/core/redis";
try {
  const time = Number(await redis.get("worker:heartbeat"));
  if (!time || Date.now() - time > 30000) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
