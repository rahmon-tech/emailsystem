import { redis } from "./redis";
import { digest } from "./security";
import type { WarmupProfile } from "./safety-config";
import {
  DOMAIN_SOFT_START_IDLE_MS,
  DOMAIN_SOFT_START_TTL_SECONDS,
  domainSoftStartSlowdown,
} from "./domain-soft-start";

export {
  acquireExperimentPacing,
  commitExperimentPacing,
  releaseExperimentPacing,
} from "./experiment-smooth-pacing";
export type { ExperimentPacingPermit } from "./experiment-smooth-pacing";

export interface Candidate {
  id: string;
  weight: number;
  perSecond: number;
  perMinute: number;
  concurrency: number;
  group: string;
  cost: number;
}
export interface DispatchPacingPolicy {
  accountPerMinute: number | null;
  domainPerMinute: number | null;
  campaignId: string | null;
  campaignPerMinute: number | null;
}
const noPacingPolicy: DispatchPacingPolicy = {
  accountPerMinute: null,
  domainPerMinute: null,
  campaignId: null,
  campaignPerMinute: null,
};

// Redis server time and atomic counters coordinate every process; leases bound crash recovery.
// Provider, provider-rate-group, sender-domain, account, and campaign pacing are enforced atomically.
const acquireLua = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
local candidates=cjson.decode(ARGV[1]);local token=ARGV[2]; local selected=nil; local score=nil
for _,c in ipairs(candidates) do
 local base=KEYS[1]..c.id;local group=KEYS[1]..'g:'..c.group;local pacing=KEYS[1]..'p:'..c.pacingGroup
 local account=KEYS[1]..'a';local campaign=KEYS[1]..'c:'..c.campaignGroup
 redis.call('ZREMRANGEBYSCORE',base..':active','-inf',ms);redis.call('ZREMRANGEBYSCORE',group..':active','-inf',ms)
 if c.smooth==1 then redis.call('ZREMRANGEBYSCORE',pacing..':active','-inf',ms) end
 local sec=':'..math.floor(ms/1000);local minute=':'..math.floor(ms/60000)
 local providerNext=tonumber(redis.call('GET',base..':next') or '0')
 local groupNext=tonumber(redis.call('GET',group..':next') or '0')
 local pacingNext=tonumber(redis.call('GET',pacing..':next') or '0')
 local accountNext=tonumber(redis.call('GET',account..':next') or '0')
 local campaignNext=tonumber(redis.call('GET',campaign..':next') or '0')
 local accountAllowed=c.accountMinute<=0 or (
   ms>=accountNext and tonumber(redis.call('GET',account..':m'..minute) or '0')+c.cost<=c.accountMinute
 )
 local campaignAllowed=c.campaignMinute<=0 or (
   ms>=campaignNext and tonumber(redis.call('GET',campaign..':m'..minute) or '0')+c.cost<=c.campaignMinute
 )
 local pacingAllowed=(c.smooth==0) or (
   accountAllowed and campaignAllowed
   and ms>=providerNext and ms>=groupNext and ms>=pacingNext
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
local account=KEYS[1]..'a';local campaign=KEYS[1]..'c:'..c.campaignGroup
if c.smooth==1 then
 local providerGap=math.ceil(math.max(math.ceil(1000*c.cost/c.perSecond),math.ceil(60000*c.cost/c.perMinute))*c.slowdown)
 local groupGap=math.ceil(math.max(math.ceil(1000*c.cost/c.groupSecond),math.ceil(60000*c.cost/c.groupMinute))*c.groupSlowdown)
 local pacingGap=math.ceil(math.max(math.ceil(1000*c.cost/c.pacingSecond),math.ceil(60000*c.cost/c.pacingMinute))*c.pacingSlowdown)
 redis.call('SET',base..':next',ms+providerGap,'PX',math.max(180000,providerGap+120000))
 redis.call('SET',group..':next',ms+groupGap,'PX',math.max(180000,groupGap+120000))
 redis.call('SET',pacing..':next',ms+pacingGap,'PX',math.max(180000,pacingGap+120000))
 local psk=pacing..':s:'..math.floor(ms/1000);local pmk=pacing..':m:'..math.floor(ms/60000)
 redis.call('INCRBY',psk,c.cost);redis.call('PEXPIRE',psk,2000);redis.call('INCRBY',pmk,c.cost);redis.call('PEXPIRE',pmk,120000)
 redis.call('ZADD',pacing..':active',ms+120000,token);redis.call('PEXPIRE',pacing..':active',180000)
 if c.accountMinute>0 then
   local accountGap=math.ceil(60000*c.cost/c.accountMinute)
   redis.call('SET',account..':next',ms+accountGap,'PX',math.max(180000,accountGap+120000))
   local amk=account..':m:'..math.floor(ms/60000);redis.call('INCRBY',amk,c.cost);redis.call('PEXPIRE',amk,120000)
 end
 if c.campaignMinute>0 then
   local campaignGap=math.ceil(60000*c.cost/c.campaignMinute)
   redis.call('SET',campaign..':next',ms+campaignGap,'PX',math.max(180000,campaignGap+120000))
   local cmk=campaign..':m:'..math.floor(ms/60000);redis.call('INCRBY',cmk,c.cost);redis.call('PEXPIRE',cmk,120000)
 end
 local warmLastKey=pacing..':warm:last';local warmCountKey=pacing..':warm:count'
 local warmLast=tonumber(redis.call('GET',warmLastKey) or '0')
 if warmLast==0 or ms-warmLast>${DOMAIN_SOFT_START_IDLE_MS} then redis.call('SET',warmCountKey,0) end
 redis.call('INCR',warmCountKey);redis.call('EXPIRE',warmCountKey,${DOMAIN_SOFT_START_TTL_SECONDS})
 redis.call('SET',warmLastKey,ms,'EX',${DOMAIN_SOFT_START_TTL_SECONDS})
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
export function senderDomainWarmKeys(userId: string, pacingGroup: string) {
  const base = `dispatch:${userId}:p:${pacingGroup}:warm`;
  return { count: base + ":count", last: base + ":last" };
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
async function domainWarmState(userId: string, pacingGroups: string[]) {
  const groups = [...new Set(pacingGroups)];
  if (!groups.length)
    return new Map<string, { count: number; last: number | null }>();
  const keys = groups.flatMap((group) => {
    const warm = senderDomainWarmKeys(userId, group);
    return [warm.count, warm.last];
  });
  const values = await redis.mget(...keys);
  return new Map(
    groups.map((group, index) => {
      const count = Number(values[index * 2] ?? 0);
      const last = Number(values[index * 2 + 1] ?? 0);
      return [
        group,
        {
          count: Number.isFinite(count) ? Math.max(0, count) : 0,
          last: Number.isFinite(last) && last > 0 ? last : null,
        },
      ];
    }),
  );
}
export async function acquireProvider(
  userId: string,
  candidates: Candidate[],
  token: string,
  ratePeers: Candidate[] = candidates,
  smoothPacing = process.env.NODE_ENV !== "test",
  warmupProfile: WarmupProfile = "balanced",
  pacingPolicy: DispatchPacingPolicy = noPacingPolicy,
) {
  const pacingGroups = [
    ...candidates.map((candidate) => pacingGroupFromRateGroup(candidate.group)),
    ...ratePeers.map((candidate) => pacingGroupFromRateGroup(candidate.group)),
  ];
  const [slowdowns, warmState] = smoothPacing
    ? await Promise.all([
        providerSlowdowns(userId, [
          ...candidates.map((candidate) => candidate.id),
          ...ratePeers.map((candidate) => candidate.id),
        ]),
        domainWarmState(userId, pacingGroups),
      ])
    : [
        new Map<string, number>(),
        new Map<string, { count: number; last: number | null }>(),
      ];
  const now = Date.now();
  const campaignGroup = pacingPolicy.campaignId
    ? digest(`${userId}:campaign:${pacingPolicy.campaignId}`)
    : "none";
  const enriched = candidates.map((c) => {
    const pacingGroup = pacingGroupFromRateGroup(c.group);
    const peers = ratePeers.filter((p) => p.group === c.group);
    const providerPeers = peers.length ? peers : [c];
    const pacingPeers = ratePeers.filter(
      (p) => pacingGroupFromRateGroup(p.group) === pacingGroup,
    );
    const domainPeers = pacingPeers.length ? pacingPeers : [c];
    const pacingSecond = Math.min(...domainPeers.map((p) => p.perSecond));
    const providerDomainMinute = Math.min(...domainPeers.map((p) => p.perMinute));
    const pacingMinute = Math.min(
      providerDomainMinute,
      pacingPolicy.domainPerMinute ?? providerDomainMinute,
    );
    const warm = warmState.get(pacingGroup) ?? { count: 0, last: null };
    const idleMs = warm.last === null ? null : Math.max(0, now - warm.last);
    return {
      ...c,
      pacingGroup,
      campaignGroup,
      accountMinute: pacingPolicy.accountPerMinute ?? 0,
      campaignMinute:
        pacingPolicy.campaignId && pacingPolicy.campaignPerMinute
          ? pacingPolicy.campaignPerMinute
          : 0,
      smooth: smoothPacing ? 1 : 0,
      slowdown: slowdowns.get(c.id) ?? 1,
      groupSlowdown: Math.max(
        ...providerPeers.map((peer) => slowdowns.get(peer.id) ?? 1),
      ),
      groupSecond: Math.min(...providerPeers.map((p) => p.perSecond)),
      groupMinute: Math.min(...providerPeers.map((p) => p.perMinute)),
      groupConcurrency: Math.min(...providerPeers.map((p) => p.concurrency)),
      pacingSecond,
      pacingMinute,
      pacingSlowdown: smoothPacing
        ? domainSoftStartSlowdown(
            pacingMinute,
            warm.count,
            idleMs,
            warmupProfile,
          )
        : 1,
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