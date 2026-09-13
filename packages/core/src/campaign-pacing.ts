export type CampaignPacingStatus =
  | "complete"
  | "waiting"
  | "estimating"
  | "active";

export type CampaignPacing = {
  status: CampaignPacingStatus;
  sampleSize: number;
  remaining: number;
  messagesPerMinute: number | null;
  estimatedSeconds: number | null;
  observedSeconds: number;
  idleSeconds: number | null;
};

const MIN_SAMPLE = 3;
const MIN_OBSERVED_SECONDS = 5;
const STALE_AFTER_SECONDS = 30;
const MAX_ESTIMATE_SECONDS = 7 * 24 * 60 * 60;

export function deriveCampaignPacing(
  transmissionStartedAt: Date[],
  remaining: number,
  now = Date.now(),
): CampaignPacing {
  if (remaining <= 0)
    return {
      status: "complete",
      sampleSize: transmissionStartedAt.length,
      remaining: 0,
      messagesPerMinute: null,
      estimatedSeconds: 0,
      observedSeconds: 0,
      idleSeconds: null,
    };

  const starts = transmissionStartedAt
    .map((value) => value.getTime())
    .filter((value) => Number.isFinite(value) && value <= now)
    .sort((a, b) => a - b);

  if (!starts.length)
    return {
      status: "waiting",
      sampleSize: 0,
      remaining,
      messagesPerMinute: null,
      estimatedSeconds: null,
      observedSeconds: 0,
      idleSeconds: null,
    };

  const oldest = starts[0];
  const latest = starts.at(-1)!;
  const observedSeconds = Math.max(
    MIN_OBSERVED_SECONDS,
    Math.round((now - oldest) / 1000),
  );
  const idleSeconds = Math.max(0, Math.round((now - latest) / 1000));
  const messagesPerMinute =
    Math.round(((starts.length * 60) / observedSeconds) * 10) / 10;

  if (idleSeconds > STALE_AFTER_SECONDS)
    return {
      status: "waiting",
      sampleSize: starts.length,
      remaining,
      messagesPerMinute,
      estimatedSeconds: null,
      observedSeconds,
      idleSeconds,
    };

  if (starts.length < MIN_SAMPLE || observedSeconds < MIN_OBSERVED_SECONDS)
    return {
      status: "estimating",
      sampleSize: starts.length,
      remaining,
      messagesPerMinute,
      estimatedSeconds: null,
      observedSeconds,
      idleSeconds,
    };

  const estimatedSeconds = Math.min(
    MAX_ESTIMATE_SECONDS,
    Math.ceil((remaining / messagesPerMinute) * 60),
  );
  return {
    status: "active",
    sampleSize: starts.length,
    remaining,
    messagesPerMinute,
    estimatedSeconds,
    observedSeconds,
    idleSeconds,
  };
}
