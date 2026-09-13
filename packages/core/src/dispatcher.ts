import { redis } from "./redis";
import { digest } from "./security";
export interface Candidate {
  id: string;
  weight: number;
  perSecond: number;
  perMinute: number;
  concurrency: number;
  group: string;
  cost: number;
}
// Redis server time and atomic counters coordinate every process; leases bound crash recovery.
// Provider and sender-domain "next" timestamps smooth fixed-window capacity into evenly spaced sends.
const acquireLua = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
local candidates=cjson.decode(ARGV[1]);local token=ARGV[2]; local selected=nil; local score=nil
for _,c in ipairs(candidates) do
 local base=KEYS[1]..c.id;local group=KEYS[1]..'g:'..c.group
 redis.call('ZREMRANGEBYSCORE',base..':active','-inf',ms);redis.call('ZREMRANGEBYSCORE',group..':active','-inf',ms)
 local sec=':'..math.floor(ms/1000);local minute=':'..math.floor(ms/60000)
 local providerNext=tonumber(redis.call('GET',base..':next') or '0')
 local groupNext=tonumber(redis.call('GET',group..':next') or '0')
 if ms>=providerNext and ms>=groupNext
 and redis.call('ZCARD',base..':active')<c.concurrency and redis.call('ZCARD',group..':active')<c.groupConcurrency
 and tonumber(redis.call('GET',base..':s'..sec) or '0')+c.cost<=c.perSecond
 and tonumber(redis.call('GET',base..':m'..minute) or '0')+c.cost<=c.perMinute
 and tonumber(redis.call('GET',group..':s'..sec) or '0')+c.cost<=c.groupSecond
 and tonumber(redis.call('GET',group..':m'..minute) or '0')+c.cost<=c.groupMinute then
 local v=tonumber(redis.call('HGET',KEYS[2],c.id) or '0')
 if not score or v<score then selected=c;score=v end
 end
end
if not selected then return '' end
local c=selected;local base=KEYS[1]..c.id;local group=KEYS[1]..'g:'..c.group
local providerGap=math.max(math.ceil(1000*c.cost/c.perSecond),math.ceil(60000*c.cost/c.perMinute))
local groupGap=math.max(math.ceil(1000*c.cost/c.groupSecond),math.ceil(60000*c.cost/c.groupMinute))
redis.call('SET',base..':next',ms+providerGap,'PX',math.max(180000,providerGap+120000))
redis.call('SET',group..':next',ms+groupGap,'PX',math.max(180000,groupGap+120000))
for _,b in ipairs({base,group}) do
 local sk=b..':s:'..math.floor(ms/1000);local mk=b..':m:'..math.floor(ms/60000)
 redis.call('INCRBY',sk,c.cost);redis.call('PEXPIRE',sk,2000);redis.call('INCRBY',mk,c.cost);redis.call('PEXPIRE',mk,120000)
 redis.call('ZADD',b..':active',ms+120000,token);redis.call('PEXPIRE',b..':active',180000)
end
redis.call('HSET',KEYS[2],c.id,score+1/c.weight);redis.call('EXPIRE',KEYS[2],3600)
return c.id`;
export function rateGroup(
  userId: string,
  type: string,
  from: string,
  region = "",
) {
  // Keep the public signature stable for existing callers, but deliberately group
  // every provider that sends for the same user + sender domain together.
  // Provider rotation must not multiply the sender-domain transmission rate.
  void type;
  void region;
  const domain = (from.split("@")[1] ?? "").trim().toLowerCase();
  return digest(`${userId}:${domain}`);
}
export async function acquireProvider(
  userId: string,
  candidates: Candidate[],
  token: string,
  ratePeers: Candidate[] = candidates,
) {
  const enriched = candidates.map((c) => {
    const peers = ratePeers.filter((p) => p.group === c.group);
    return {
      ...c,
      groupSecond: Math.min(...peers.map((p) => p.perSecond)),
      groupMinute: Math.min(...peers.map((p) => p.perMinute)),
      groupConcurrency: Math.min(...peers.map((p) => p.concurrency)),
    };
  });
  const prefix = `dispatch:${userId}:`;
  const id = await redis.eval(
    acquireLua,
    2,
    prefix,
    prefix + "fairness",
    JSON.stringify(enriched),
    token,
  );
  return typeof id === "string" && id ? id : null;
}
export async function releaseProvider(
  userId: string,
  candidate: Candidate,
  token: string,
) {
  const prefix = `dispatch:${userId}:`;
  await redis
    .multi()
    .zrem(prefix + candidate.id + ":active", token)
    .zrem(prefix + "g:" + candidate.group + ":active", token)
    .exec();
}
