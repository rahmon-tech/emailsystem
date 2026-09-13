import { db } from "@emailsystem/db";
import { redis } from "./redis";
import { providerAdaptiveKey } from "./dispatcher";
import {
  ADAPTIVE_PACING_WINDOW_MS,
  deriveAdaptivePacing,
} from "./pacing-policy";

export async function refreshProviderAdaptation(now = new Date()) {
  const windowStart = new Date(now.getTime() - ADAPTIVE_PACING_WINDOW_MS);
  const providers = await db.providerConnection.findMany({
    where: {
      deletedAt: null,
      enabled: true,
      health: "HEALTHY",
      attempts: { some: { finishedAt: { gte: windowStart } } },
    },
    select: {
      id: true,
      userId: true,
      cooldownUntil: true,
      attempts: {
        where: { finishedAt: { gte: windowStart } },
        orderBy: { finishedAt: "desc" },
        take: 20,
        select: { state: true, category: true, finishedAt: true },
      },
    },
    take: 100,
  });

  let slowed = 0;
  let cooldownsExtended = 0;
  for (const provider of providers) {
    const decision = deriveAdaptivePacing(provider.attempts, now.getTime());
    const key = providerAdaptiveKey(provider.userId, provider.id);
    if (decision.slowdown > 1) {
      await redis.set(key, String(decision.slowdown), "EX", 45);
      slowed++;
    } else {
      await redis.del(key);
    }

    if (
      decision.cooldownUntil &&
      (!provider.cooldownUntil || provider.cooldownUntil < decision.cooldownUntil)
    ) {
      const updated = await db.providerConnection.updateMany({
        where: {
          id: provider.id,
          userId: provider.userId,
          enabled: true,
          health: "HEALTHY",
          deletedAt: null,
          OR: [
            { cooldownUntil: null },
            { cooldownUntil: { lt: decision.cooldownUntil } },
          ],
        },
        data: { cooldownUntil: decision.cooldownUntil },
      });
      cooldownsExtended += updated.count;
    }
  }

  return { inspected: providers.length, slowed, cooldownsExtended };
}
