import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { redis } from "@emailsystem/core/redis";
import { RollingGovernor, type Budget } from "@emailsystem/core/safety-governor";
const clients: string[] = [];
const start = 1800000000000;
async function fixture(limit = 10) {
  const user = crypto.randomUUID(); clients.push(user);
  let now = start;
  const g = new RollingGovernor(redis, user, () => now);
  await g.restore([]);
  const budgets: Budget[] = ["account", "domain:example.com", "provider:p1", "campaign:c1"].map(scope => ({ scope, limit }));
  return { user, g, budgets, advance: (ms: number) => { now += ms; } };
}
after(async () => { for (const user of clients) await redis.del(`safety:{${user}}`); await redis.quit(); });
test("rolling budgets allow exact boundary, refuse overage atomically and expire conservatively", async () => {
  const f = await fixture();
  assert.equal((await f.g.reserve("one", f.budgets, 9)).allowed, true);
  await f.g.commit("one");
  assert.equal((await f.g.reserve("two", f.budgets, 1)).allowed, true);
  await f.g.commit("two");
  const blocked = await f.g.reserve("three", f.budgets, 1);
  assert.equal(blocked.allowed, false);
  assert(blocked.nextReleaseAt! >= start + 86400000);
  f.advance(86400000 - 1);
  assert.equal((await f.g.reserve("early", f.budgets, 1)).allowed, false);
  f.advance(60001);
  assert.equal((await f.g.reserve("later", f.budgets, 10)).allowed, true);
});
test("each independent cap is binding and failed reservations charge no other scope", async () => {
  for (let i = 0; i < 4; i++) {
    const f = await fixture(100);
    f.budgets[i].limit = 3;
    assert.equal((await f.g.reserve("copies", f.budgets, 4)).allowed, false);
    assert((await f.g.inspect(f.budgets)).every(b => b.used === 0));
    assert.equal((await f.g.reserve("fit", f.budgets, 3)).allowed, true);
    await f.g.commit("fit");
    assert.equal((await f.g.reserve("extra", f.budgets, 1)).allowed, false);
  }
});
test("pre-send release and expired unstarted leases return capacity; committed unknowns stay charged", async () => {
  const f = await fixture(2);
  await f.g.reserve("aborted", f.budgets, 2);
  await f.g.release("aborted"); await f.g.release("aborted");
  assert.equal((await f.g.reserve("unknown", f.budgets, 1)).allowed, true);
  await f.g.commit("unknown"); await f.g.release("unknown");
  await f.g.reserve("crashed-before-send", f.budgets, 1);
  f.advance(180001);
  assert.equal((await f.g.reserve("replacement", f.budgets, 1)).allowed, true);
  assert.equal((await f.g.reserve("overflow", f.budgets, 1)).allowed, false);
  assert.equal(await f.g.commit("crashed-before-send"), false);
});
test("100 concurrent Redis reservations with ten remaining permit exactly ten", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => f.g.reserve(String(i), f.budgets, 1)));
  assert.equal(results.filter(r => r.allowed).length, 10);
});
test("separate worker processes share one account cap across independent providers", async () => {
  const f = await fixture(100);
  const code = `import { redis } from './packages/core/src/redis.ts'; import { RollingGovernor } from './packages/core/src/safety-governor.ts'; const g = new RollingGovernor(redis, process.argv[1], () => ${start}); let n=0; for(let i=0;i<100;i++){const token=crypto.randomUUID(); const r=await g.reserve(token,[{scope:'account',limit:100},{scope:'provider:'+process.argv[2],limit:100}],1);if(r.allowed){n++;await g.commit(token);}} process.stdout.write(String(n)); await redis.quit();`;
  const run = (provider: string) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, f.user, provider], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = ""; child.stdout.on("data", b => output += b); child.stderr.on("data", b => error += b);
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve(Number(output)) : reject(new Error(error)));
  });
  const counts = await Promise.all([run("p1"), run("p2"), run("p3")]);
  assert.equal(counts.reduce((a,b) => a+b,0), 100);
});
test("missing Redis ledger fails closed until authoritative restoration", async () => {
  const f = await fixture(); await redis.del(`safety:{${f.user}}`);
  await assert.rejects(() => f.g.reserve("missing", f.budgets, 1), /restore/i);
  await f.g.restore([{ at: start, cost: 10, scopes: f.budgets.map(b => b.scope) }]);
  assert.equal((await f.g.reserve("rebuilt", f.budgets, 1)).allowed, false);
});
