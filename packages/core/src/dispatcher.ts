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
// Provider, provider-rate-group, and sender-domain pacing are enforced atomically.
const acquireLua = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
local candidates=cjson.decode(ARGV[1]);local token=ARGV[2]; local selected=nil; local score=nil
for _,c in ipairs(candidates) do
 local base=KEYS[1]..c.id;local group=KEYS[1]..'g:'..c.group;local pacing=KEYS[1]..'p:'..c.pacingGroup
 redis.call('ZREMRANGEBYSCORE',base..':active','-inf',ms);redis.call('ZREMRANGEBYSCORE',group..':active','-inf',ms)
 if c.smooth==1 then redis.call('ZREMRANGEBYSCORE',pacing..':active','-inf',ms) end
 local sec=':'..math.floor(ms/1000);local minute=':'..math.floor(ms/60000)
 local providerNext=tonumber(redis.call('GET',base..':next') or '0')
 local groupNext=tonumber(redis.call('GET',group..':next') or '0')
 local pacingNext=tonumber(redis.call('GET',pacing..':next') or '0')
 local pacingAllowed=(c.smooth==0) or (
   ms>=providerNext and ms>=groupNext and ms>=pacingNext
   and redis.call('ZCARD',pacing..':active')<1
   and tonumber(redis.call('GET',pacing..':s'..sec) or '0')+c.cost<=c.pacingSecond
   and tonumber(redis.call('GET',pacing..':m'..minute) or '0')+c.cost<=c.pacingMinute
 )
 if pacingAllowed
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
local c=selected;local base=KEYS[1]..c.id;local group=KEYS[1]..'g:'..c.group;local pacing=KEYS[1]..'p:'..c.pacingGroup
if c.smooth==1 then
 local providerGap=math.ceil(math.max(math.ceil(1000*c.cost/c.perSecond),math.ceil(60000*c.cost/c.perMinute))*c.slowdown)
 local groupGap=math.ceil(math.max(math.ceil(1000*c.cost/c.groupSecond),math.ceil(60000*c.cost/c.groupMinute))*c.groupSlowdown)
 local pacingGap=math.max(math.ceil(1000*c.cost/c.pacingSecond),math.ceil(60000*c.cost/c.pacingMinute))
 redis.call('SET',base..':next',ms+providerGap,'PX',math.max(180000,providerGap+120000))
 redis.call('SET',group..':next',ms+groupGap,'PX',math.max(180000,groupGap+120000))
 redis.call('SET',pacing..':next',ms+pacingGap,'PX',math.max(180000,pacingGap+120000))
 local psk=pacing..':s:'..math.floor(ms/1000);local pmk=pacing..':m:'..math.floor(ms/60000)
 redis.call('INCRBY',psk,c.cost);redis.call('PEXPIRE',psk,2000);redis.call('INCRBY',pmk,c.cost);redis.call('PEXPIRE',pmk,120000)
 redis.call('ZADD',pacing..':active',ms+120000,token);redis.call('PEXPIRE',pacing..':active',180000)
end
for _,b in ipairs({base,group}) do
 local sk=b..':s:'..math.floor(ms/1000);local mk=b..':m:'..math.floor(ms/60000)
 redis.call('INCRBY',sk,c.cost);redis.call('PEXPIRE',sk,2000);redis.call('INCRBY',mk,c.cost);redis.call('PEXPIRE',mk,120000)
 redis.call('ZADD',b..':active',ms+120000,token);redis.call('PEXPIRE',b..':active',180000)
end
redis.call('HSET',KEYS[2],c.id,score+1/c.weight);redis.call('EXPIRE',KEYS[2],3600)
return c.id`;
export function senderDomainRateGroup(userId: string, from: string) {
  const domain = (from.split("@")[1] ?? "").trim().toLowerCase();
  return digest(`${userId}:sender-domain:${domain}`);
}
export function rateGroup(
  userId: string,
  type: string,
  from: string,
  region = "",
) {
  const domain = (from.split("@")[1] ?? "").trim().toLowerCase();
  // The first digest preserves provider-specific quota/rate grouping. The second
  // is a provider-independent sender-domain pacing key carried alongside it.
  return `${digest(`${userId}:${type}:${domain}:${region}`)}.${senderDomainRateGroup(userId, from)}`;
}
function pacingGroupFromRateGroup(group: string) {
  return group.split(".")[1] ?? group;
}
export function providerAdaptiveKey(userId: string, providerId: string) {
  return `dispatch:${userId}:adaptive:${providerId}`;
}
function clampSlowdown(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(4, Math.max(1, parsed)) : 1;
}
async function providerSlowdowns(userId: string, providerIds: string[]) {
  const ids = [...new Set(providerIds)];
  if (!ids.length) return new Map<string, number>();
  const values = await redis.mget(
    ...ids.map((id) => providerAdaptiveKey(userId, id)),
  );
  return new Map(ids.map((id, index) => [id, clampSlowdown(values[index])]));
}
export async function acquireProvider(
  userId: string,
  candidates: Candidate[],
  token: string,
  ratePeers: Candidate[] = candidates,
  smoothPacing = process.env.NODE_ENV !== "test",
) {
  const slowdowns = smoothPacing
    ? await providerSlowdowns(userId, [
        ...candidates.map((candidate) => candidate.id),
        ...ratePeers.map((candidate) => candidate.id),
      ])
    : new Map<string, number>();
  const enriched = candidates.map((c) => {
    const pacingGroup = pacingGroupFromRateGroup(c.group);
    const peers = ratePeers.filter((p) => p.group === c.group);
    const providerPeers = peers.length ? peers : [c];
    const pacingPeers = ratePeers.filter(
      (p) => pacingGroupFromRateGroup(p.group) === pacingGroup,
    );
    const domainPeers = pacingPeers.length ? pacingPeers : [c];
    return {
      ...c,
      pacingGroup,
      smooth: smoothPacing ? 1 : 0,
      slowdown: slowdowns.get(c.id) ?? 1,
      groupSlowdown: Math.max(
        ...providerPeers.map((peer) => slowdowns.get(peer.id) ?? 1),
      ),
      groupSecond: Math.min(...providerPeers.map((p) => p.perSecond)),
      groupMinute: Math.min(...providerPeers.map((p) => p.perMinute)),
      groupConcurrency: Math.min(...providerPeers.map((p) => p.concurrency)),
      pacingSecond: Math.min(...domainPeers.map((p) => p.perSecond)),
      pacingMinute: Math.min(...domainPeers.map((p) => p.perMinute)),
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
    .zrem(
      prefix + "p:" + pacingGroupFromRateGroup(candidate.group) + ":active",
      token,
    )
    .exec();
}
