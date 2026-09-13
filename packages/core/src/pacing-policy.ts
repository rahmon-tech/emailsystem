export type PacingAttempt = {
  state: string;
  category: string | null;
  finishedAt: Date | null;
};

export type AdaptivePacingDecision = {
  slowdown: number;
  cooldownUntil: Date | null;
  sampleSize: number;
  transientCount: number;
  consecutiveTransient: number;
};

export const ADAPTIVE_PACING_WINDOW_MS = 15 * 60_000;
const SAMPLE_FLOOR = 10;
const MAX_SLOWDOWN = 4;
const RATE_LIMIT_BASE_MS = 30_000;
const TEMPORARY_BASE_MS = 15_000;
const RATE_LIMIT_CAP_MS = 15 * 60_000;
const TEMPORARY_CAP_MS = 5 * 60_000;

function transient(category: string | null) {
  return category === "temporary" || category === "rate_limit";
}

export function deriveAdaptivePacing(
  attempts: PacingAttempt[],
  now = Date.now(),
): AdaptivePacingDecision {
  const recent = attempts
    .filter(
      (attempt) =>
        attempt.finishedAt &&
        attempt.finishedAt.getTime() <= now &&
        now - attempt.finishedAt.getTime() <= ADAPTIVE_PACING_WINDOW_MS,
    )
    .sort(
      (a, b) =>
        b.finishedAt!.getTime() - a.finishedAt!.getTime(),
    )
    .slice(0, 20);

  if (!recent.length)
    return {
      slowdown: 1,
      cooldownUntil: null,
      sampleSize: 0,
      transientCount: 0,
      consecutiveTransient: 0,
    };

  const transientCount = recent.filter((attempt) => transient(attempt.category)).length;
  let consecutiveTransient = 0;
  for (const attempt of recent) {
    if (!transient(attempt.category)) break;
    consecutiveTransient++;
  }

  const transientPressure = transientCount / Math.max(SAMPLE_FLOOR, recent.length);
  const rateLimitInStreak = recent
    .slice(0, consecutiveTransient)
    .some((attempt) => attempt.category === "rate_limit");
  const slowdown =
    transientCount === 0
      ? 1
      : Math.min(
          MAX_SLOWDOWN,
          Math.round(
            (1 +
              transientPressure * 2 +
              Math.min(1.5, consecutiveTransient * 0.25) +
              (rateLimitInStreak ? 0.25 : 0)) *
              100,
          ) / 100,
        );

  let cooldownUntil: Date | null = null;
  if (consecutiveTransient) {
    const latest = recent[0];
    const rateLimited = latest.category === "rate_limit";
    const base = rateLimited ? RATE_LIMIT_BASE_MS : TEMPORARY_BASE_MS;
    const cap = rateLimited ? RATE_LIMIT_CAP_MS : TEMPORARY_CAP_MS;
    const delay = Math.min(
      cap,
      base * 2 ** Math.max(0, consecutiveTransient - 1),
    );
    const candidate = new Date(latest.finishedAt!.getTime() + delay);
    if (candidate.getTime() > now) cooldownUntil = candidate;
  }

  return {
    slowdown,
    cooldownUntil,
    sampleSize: recent.length,
    transientCount,
    consecutiveTransient,
  };
}
