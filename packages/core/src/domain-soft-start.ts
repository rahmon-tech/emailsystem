import type { WarmupProfile } from "./safety-config";

export const DOMAIN_SOFT_START_IDLE_MS = 5 * 60_000;
export const DOMAIN_SOFT_START_TTL_SECONDS = 10 * 60;

const profiles: Record<
  WarmupProfile,
  {
    minimumPerMinute: number;
    stages: readonly { until: number; slowdown: number }[];
  }
> = {
  conservative: {
    minimumPerMinute: 60,
    stages: [
      { until: 10, slowdown: 6 },
      { until: 30, slowdown: 3 },
      { until: 60, slowdown: 1.5 },
    ],
  },
  balanced: {
    minimumPerMinute: 120,
    stages: [
      { until: 5, slowdown: 4 },
      { until: 15, slowdown: 2 },
      { until: 30, slowdown: 1.25 },
    ],
  },
  high_capacity: {
    minimumPerMinute: 240,
    stages: [
      { until: 5, slowdown: 2 },
      { until: 15, slowdown: 1.5 },
      { until: 30, slowdown: 1.25 },
    ],
  },
};

export function domainSoftStartSlowdown(
  perMinute: number,
  recentCount: number,
  idleMs: number | null,
  profile: WarmupProfile = "balanced",
) {
  const policy = profiles[profile];
  if (perMinute < policy.minimumPerMinute) return 1;
  const count = idleMs === null || idleMs > DOMAIN_SOFT_START_IDLE_MS ? 0 : recentCount;
  return policy.stages.find((stage) => count < stage.until)?.slowdown ?? 1;
}
