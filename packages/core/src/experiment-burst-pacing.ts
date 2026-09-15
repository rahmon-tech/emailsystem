import { redis } from "./redis";

const BURST_RESERVATION_MS = 30_000;

export type ExperimentBurstPacingPermit =
  | {
      allowed: true;
      nextAllowedAt: number;
      occupancyBeforeStart: number;
      occupancyAfterStart: number;
    }
  | {
      allowed: false;
      nextAllowedAt: number;
      occupancyBeforeStart: number;
      occupancyAfterStart: number;
    };

export type ExperimentBurstPacingEvidence = {
  profile: "bounded-burst";
  windowMs: number;
  burstSize: number;
  occupancyBeforeStart: number;
  occupancyAfterStart: number;
};

const acquireBurstLua = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
local token=ARGV[1]; local window=tonumber(ARGV[2]); local burst=tonumber(ARGV[3]); local reservation=tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ms-window)
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ms)
local committed=redis.call('ZCARD',KEYS[1]); local reserved=redis.call('ZCARD',KEYS[2]); local occupied=committed+reserved
if occupied>=burst then
  local nextAllowed=ms+window
  local firstCommitted=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES')
  if #firstCommitted>0 then nextAllowed=math.min(nextAllowed,tonumber(firstCommitted[2])+window) end
  local firstReserved=redis.call('ZRANGE',KEYS[2],0,0,'WITHSCORES')
  if #firstReserved>0 then nextAllowed=math.min(nextAllowed,tonumber(firstReserved[2])) end
  return {0,nextAllowed,occupied,occupied}
end
redis.call('ZADD',KEYS[2],ms+reservation,token)
local ttl=math.max(120000,window+120000)
redis.call('PEXPIRE',KEYS[1],ttl); redis.call('PEXPIRE',KEYS[2],ttl)
return {1,ms,occupied,occupied+1}`;

const commitBurstLua = `
local score=redis.call('ZSCORE',KEYS[2],ARGV[1])
if not score then return 0 end
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
redis.call('ZREM',KEYS[2],ARGV[1]); redis.call('ZADD',KEYS[1],ms,ARGV[1])
redis.call('HSET',KEYS[3],
  'profile','bounded-burst',
  'windowMs',ARGV[2],
  'burstSize',ARGV[3],
  'occupancyBeforeStart',ARGV[4],
  'occupancyAfterStart',ARGV[5])
local ttl=math.max(120000,tonumber(ARGV[2])+120000)
redis.call('PEXPIRE',KEYS[1],ttl); redis.call('PEXPIRE',KEYS[2],ttl); redis.call('PEXPIRE',KEYS[3],ttl)
return 1`;

const releaseBurstLua = `
return redis.call('ZREM',KEYS[1],ARGV[1])`;

function burstKeys(userId: string, runId: string) {
  const base = `dispatch:${userId}:experiment:${runId}:burst`;
  return {
    committed: `${base}:committed`,
    reserved: `${base}:reserved`,
    evidence: (token: string) => `${base}:evidence:${token}`,
  };
}

export async function acquireExperimentBurstPacing(
  userId: string,
  runId: string,
  token: string,
  windowMs: number,
  burstSize: number,
): Promise<ExperimentBurstPacingPermit> {
  if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > 60_000)
    throw new Error("Experiment bounded-burst window must be 1..60000ms.");
  if (!Number.isInteger(burstSize) || burstSize <= 0 || burstSize > 50)
    throw new Error("Experiment bounded-burst size must be 1..50.");
  const keys = burstKeys(userId, runId);
  const raw = (await redis.eval(
    acquireBurstLua,
    2,
    keys.committed,
    keys.reserved,
    token,
    windowMs,
    burstSize,
    BURST_RESERVATION_MS,
  )) as [number | string, number | string, number | string, number | string];
  return {
    allowed: Number(raw[0]) === 1,
    nextAllowedAt: Number(raw[1]),
    occupancyBeforeStart: Number(raw[2]),
    occupancyAfterStart: Number(raw[3]),
  };
}

export async function commitExperimentBurstPacing(
  userId: string,
  runId: string,
  token: string,
  input: {
    windowMs: number;
    burstSize: number;
    occupancyBeforeStart: number;
    occupancyAfterStart: number;
  },
) {
  const keys = burstKeys(userId, runId);
  return (
    Number(
      await redis.eval(
        commitBurstLua,
        3,
        keys.committed,
        keys.reserved,
        keys.evidence(token),
        token,
        input.windowMs,
        input.burstSize,
        input.occupancyBeforeStart,
        input.occupancyAfterStart,
      ),
    ) === 1
  );
}

export async function releaseExperimentBurstPacing(
  userId: string,
  runId: string,
  token: string,
) {
  const keys = burstKeys(userId, runId);
  return Number(await redis.eval(releaseBurstLua, 1, keys.reserved, token)) === 1;
}

export async function readExperimentBurstPacingEvidence(
  userId: string,
  runId: string,
  token: string,
): Promise<ExperimentBurstPacingEvidence | null> {
  const raw = await redis.hgetall(burstKeys(userId, runId).evidence(token));
  if (raw.profile !== "bounded-burst") return null;
  const windowMs = Number(raw.windowMs);
  const burstSize = Number(raw.burstSize);
  const occupancyBeforeStart = Number(raw.occupancyBeforeStart);
  const occupancyAfterStart = Number(raw.occupancyAfterStart);
  if (
    !Number.isFinite(windowMs) ||
    !Number.isFinite(burstSize) ||
    !Number.isFinite(occupancyBeforeStart) ||
    !Number.isFinite(occupancyAfterStart)
  )
    return null;
  return {
    profile: "bounded-burst",
    windowMs,
    burstSize,
    occupancyBeforeStart,
    occupancyAfterStart,
  };
}
