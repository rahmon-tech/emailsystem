export const DOMAIN_SOFT_START_IDLE_MS = 5 * 60_000;
export const DOMAIN_SOFT_START_TTL_SECONDS = 10 * 60;
export const DOMAIN_SOFT_START_MIN_PER_MINUTE = 120;

export function domainSoftStartSlowdown(
  perMinute: number,
  recentCount: number,
  idleMs: number | null,
) {
  if (perMinute < DOMAIN_SOFT_START_MIN_PER_MINUTE) return 1;
  const count = idleMs === null || idleMs > DOMAIN_SOFT_START_IDLE_MS ? 0 : recentCount;
  if (count < 5) return 4;
  if (count < 15) return 2;
  if (count < 30) return 1.25;
  return 1;
}
