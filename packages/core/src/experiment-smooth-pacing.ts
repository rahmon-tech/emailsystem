import { redis } from "./redis";

export type ExperimentPacingPermit =
  | { allowed: true; nextAllowedAt: number }
  | { allowed: false; nextAllowedAt: number };

const experimentPacingAcquireLua = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
local token=ARGV[1];local interval=tonumber(ARGV[2]);local reservationMs=30000
local nextAllowed=tonumber(redis.call('HGET',KEYS[1],'next') or '0')
local owner=redis.call('HGET',KEYS[1],'token')
local reservedUntil=tonumber(redis.call('HGET',KEYS[1],'reservedUntil') or '0')
if owner and owner~='' and reservedUntil>ms then
  return {0,math.max(nextAllowed,reservedUntil)}
end
if owner and owner~='' and reservedUntil<=ms then
  redis.call('HDEL',KEYS[1],'token','reservedUntil')
end
if ms<nextAllowed then return {0,nextAllowed} end
local next=ms+interval
redis.call('HSET',KEYS[1],'token',token,'reservedUntil',ms+reservationMs,'next',next)
redis.call('PEXPIRE',KEYS[1],math.max(120000,interval+120000))
return {1,next}`;

const experimentPacingCommitLua = `
local owner=redis.call('HGET',KEYS[1],'token')
if not owner or owner~=ARGV[1] then return 0 end
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
local nextAllowed=tonumber(redis.call('HGET',KEYS[1],'next') or '0')
redis.call('HDEL',KEYS[1],'token','reservedUntil')
redis.call('PEXPIRE',KEYS[1],math.max(120000,nextAllowed-ms+120000))
return 1`;

const experimentPacingReleaseLua = `
local owner=redis.call('HGET',KEYS[1],'token')
if owner and owner==ARGV[1] then
  redis.call('DEL',KEYS[1])
  return 1
end
return 0`;

function experimentPacingKey(userId: string, runId: string) {
  return `dispatch:${userId}:experiment:${runId}:smooth`;
}

export async function acquireExperimentPacing(
  userId: string,
  runId: string,
  token: string,
  intervalMs: number,
): Promise<ExperimentPacingPermit> {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0 || intervalMs > 60_000)
    throw new Error("Experiment smooth pacing interval must be 1..60000ms.");
  const raw = (await redis.eval(
    experimentPacingAcquireLua,
    1,
    experimentPacingKey(userId, runId),
    token,
    intervalMs,
  )) as [number | string, number | string];
  return {
    allowed: Number(raw[0]) === 1,
    nextAllowedAt: Number(raw[1]),
  };
}

export async function commitExperimentPacing(
  userId: string,
  runId: string,
  token: string,
) {
  return (
    Number(
      await redis.eval(
        experimentPacingCommitLua,
        1,
        experimentPacingKey(userId, runId),
        token,
      ),
    ) === 1
  );
}

export async function releaseExperimentPacing(
  userId: string,
  runId: string,
  token: string,
) {
  return (
    Number(
      await redis.eval(
        experimentPacingReleaseLua,
        1,
        experimentPacingKey(userId, runId),
        token,
      ),
    ) === 1
  );
}
