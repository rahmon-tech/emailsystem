import type { Redis } from "ioredis";
export const WINDOW_MS = 86400000;
export const RESERVATION_MS = 180000;
export type Budget = { scope: string; limit: number | null };
export type Usage = Budget & { used: number; nextReleaseAt: number | null };
export type RestoredUsage = {
  at: number;
  cost: number;
  scopes: string[];
  token?: string;
};
export type Reservation = {
  allowed: boolean;
  blocked: string[];
  nextReleaseAt: number | null;
};

// All state occupies one Redis key: eviction/flush cannot leave a ready marker
// with only some counters. Scope totals make the normal path independent of sends.
const common = `
local key=KEYS[1]
local clock=redis.call('TIME'); local now=tonumber(ARGV[1]) or (clock[1]*1000+math.floor(clock[2]/1000))
local minute=math.floor(now/60000); local cutoff=minute-1440
local function field(s,b) return s..'|'..b end
local function prune(s)
 local first=tonumber(redis.call('HGET',key,s..'|first') or minute)
 local total=tonumber(redis.call('HGET',key,s..'|total') or 0)
 for b=first,math.min(cutoff-1,first+1440) do
  local f=field(s,b);local n=tonumber(redis.call('HGET',key,f) or 0)
  total=total-n;redis.call('HDEL',key,f)
 end
 redis.call('HSET',key,s..'|first',math.max(first,cutoff),s..'|total',math.max(0,total))
 return math.max(0,total)
end
local function change(s,b,n)
 local f=field(s,b)
 if n<0 and not redis.call('HGET',key,f) then return end
 redis.call('HINCRBY',key,f,n);redis.call('HINCRBY',key,s..'|total',n)
 local first=tonumber(redis.call('HGET',key,s..'|first') or b)
 redis.call('HSET',key,s..'|first',math.min(first,b))
end
local pending=cjson.decode(redis.call('HGET',key,'pending') or '{}')
local function expire()
 for token,r in pairs(pending) do
  if r.at+180000<=now then
   for _,s in ipairs(r.scopes) do prune(s);change(s,math.floor(r.at/60000),-r.cost) end
   pending[token]=nil
  end
 end
end
local function persist()
 redis.call('HSET',key,'pending',cjson.encode(pending));redis.call('EXPIRE',key,90000)
end
`;
const operation =
  common +
  `
if not redis.call('HGET',key,'ready') then return redis.error_reply('Safety ledger requires restore') end
expire()
local op=ARGV[2];local token=ARGV[3]
if op=='release' or op=='commit' then
 local r=pending[token]
 if r then
  for _,s in ipairs(r.scopes) do
   prune(s);change(s,math.floor(r.at/60000),-r.cost)
   if op=='commit' then change(s,minute,r.cost) end
  end
  pending[token]=nil
 end
 persist();return r and 1 or 0
end
local budgets=cjson.decode(ARGV[4]);local cost=tonumber(ARGV[5]);local blocked={};local usage={};local nextRelease=nil
for _,b in ipairs(budgets) do
 local used=prune(b.scope);local nextAt=nil
 if used>0 and (op=='inspect' or (b.limit~=cjson.null and used+cost>b.limit)) then
  local freed=0
  for m=cutoff,minute do
   local n=tonumber(redis.call('HGET',key,field(b.scope,m)) or 0)
   if n>0 then
    freed=freed+n;nextAt=(m+1441)*60000
    if op=='inspect' or b.limit==cjson.null or used-freed+cost<=b.limit then break end
   end
  end
 end
 table.insert(usage,{scope=b.scope,limit=b.limit,used=used,nextReleaseAt=nextAt or cjson.null})
 if b.limit~=cjson.null and used+cost>b.limit then
  table.insert(blocked,b.scope)
  nextRelease=math.max(nextRelease or 0,nextAt or now+60000)
 end
end
if op=='inspect' or op=='check' then persist();return cjson.encode(usage) end
if pending[token] then persist();return cjson.encode({allowed=true,blocked={},nextReleaseAt=cjson.null}) end
if #blocked>0 then persist();return cjson.encode({allowed=false,blocked=blocked,nextReleaseAt=nextRelease}) end
local scopes={}
for _,b in ipairs(budgets) do change(b.scope,minute,cost);table.insert(scopes,b.scope) end
pending[token]={at=now,cost=cost,scopes=scopes};persist()
return cjson.encode({allowed=true,blocked={},nextReleaseAt=cjson.null})
`;
const restore =
  common +
  `
redis.call('DEL',key);pending={}
for _,r in ipairs(cjson.decode(ARGV[2])) do
 local b=math.floor(r.at/60000)
 if b>=cutoff and (not r.token or r.at+180000>now) then
  for _,s in ipairs(r.scopes) do change(s,b,r.cost) end
  if r.token then pending[r.token]={at=r.at,cost=r.cost,scopes=r.scopes} end
 end
end
redis.call('HSET',key,'ready',now);persist();return 1
`;
export class RollingGovernor {
  readonly key: string;
  constructor(
    private client: Redis,
    userId: string,
    private clock?: () => number,
  ) {
    this.key = `safety:{${userId}}`;
  }
  private now() {
    return this.clock ? String(this.clock()) : "";
  }
  async ready() {
    const built = Number(await this.client.hget(this.key, "ready"));
    return built > (this.clock?.() ?? Date.now()) - WINDOW_MS;
  }
  async restore(rows: RestoredUsage[]) {
    await this.client.eval(
      restore,
      1,
      this.key,
      this.now(),
      JSON.stringify(rows),
    );
  }
  async reserve(
    token: string,
    budgets: Budget[],
    cost: number,
  ): Promise<Reservation> {
    if (
      !Number.isSafeInteger(cost) ||
      cost < 1 ||
      cost > 11 ||
      budgets.some(
        (b) =>
          b.limit !== null &&
          (!Number.isSafeInteger(b.limit) || b.limit < 1 || b.limit > 10000000),
      )
    )
      throw new Error("Invalid safety budget or cost");
    return JSON.parse(
      String(
        await this.client.eval(
          operation,
          1,
          this.key,
          this.now(),
          "reserve",
          token,
          JSON.stringify(budgets),
          cost,
        ),
      ),
    );
  }
  async inspect(budgets: Budget[], cost = 0): Promise<Usage[]> {
    return JSON.parse(
      String(
        await this.client.eval(
          operation,
          1,
          this.key,
          this.now(),
          cost ? "check" : "inspect",
          "",
          JSON.stringify(budgets),
          cost,
        ),
      ),
    );
  }
  async release(token: string) {
    return Boolean(
      await this.client.eval(
        operation,
        1,
        this.key,
        this.now(),
        "release",
        token,
      ),
    );
  }
  async commit(token: string) {
    return Boolean(
      await this.client.eval(
        operation,
        1,
        this.key,
        this.now(),
        "commit",
        token,
      ),
    );
  }
}
