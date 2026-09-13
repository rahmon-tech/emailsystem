import { redis } from "./redis";
import { providerAdaptiveKey } from "./dispatcher";

export type ProviderPacingInput = {
  id: string;
  name: string;
  health: string;
  enabled: boolean;
  perMinute: number;
  cooldownUntil: Date | null;
};

export type ProviderPacingTelemetry = {
  id: string;
  name: string;
  health: string;
  enabled: boolean;
  configuredPerMinute: number;
  effectivePerMinute: number;
  slowdown: number;
  cooldownUntil: Date | null;
  nextAllowedAt: Date | null;
  pressure: "disabled" | "blocked" | "cooldown" | "slowed" | "normal";
};

export function clampAdaptiveSlowdown(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(4, Math.max(1, parsed)) : 1;
}

export function effectiveProviderPerMinute(perMinute: number, slowdown: number) {
  return Math.max(1, Math.floor(perMinute / Math.max(1, slowdown)));
}

export function providerPressure(
  provider: Pick<ProviderPacingInput, "enabled" | "health" | "cooldownUntil">,
  slowdown: number,
  now = Date.now(),
): ProviderPacingTelemetry["pressure"] {
  if (!provider.enabled) return "disabled";
  if (provider.health === "POLICY_BLOCKED") return "blocked";
  if (provider.cooldownUntil && provider.cooldownUntil.getTime() > now)
    return "cooldown";
  if (slowdown > 1) return "slowed";
  return "normal";
}

export async function providerPacingTelemetry(
  userId: string,
  providers: ProviderPacingInput[],
  now = Date.now(),
) {
  if (!providers.length) return [];
  const keys = providers.flatMap((provider) => [
    providerAdaptiveKey(userId, provider.id),
    `dispatch:${userId}:${provider.id}:next`,
  ]);
  const values = await redis.mget(...keys);
  return providers.map((provider, index): ProviderPacingTelemetry => {
    const slowdown = clampAdaptiveSlowdown(values[index * 2] ?? null);
    const redisNext = Number(values[index * 2 + 1] ?? 0);
    const candidates = [
      provider.cooldownUntil?.getTime() ?? 0,
      Number.isFinite(redisNext) ? redisNext : 0,
    ].filter((value) => value > now);
    return {
      id: provider.id,
      name: provider.name,
      health: provider.health,
      enabled: provider.enabled,
      configuredPerMinute: provider.perMinute,
      effectivePerMinute: effectiveProviderPerMinute(provider.perMinute, slowdown),
      slowdown,
      cooldownUntil: provider.cooldownUntil,
      nextAllowedAt: candidates.length ? new Date(Math.max(...candidates)) : null,
      pressure: providerPressure(provider, slowdown, now),
    };
  });
}
