import { test, after } from "node:test";
import assert from "node:assert/strict";
import { redis } from "@emailsystem/core/redis";
import {
  acquireProvider,
  providerAdaptiveKey,
  releaseProvider,
  rateGroup,
  senderDomainWarmKeys,
  type Candidate,
} from "@emailsystem/core/dispatcher";

const users: string[] = [];

function candidate(id: string, group: string): Candidate {
  return {
    id,
    group,
    weight: 1,
    perSecond: 1,
    perMinute: 30,
    concurrency: 1,
    cost: 1,
  };
}

after(async () => {
  for (const user of users) {
    const keys = await redis.keys(`dispatch:${user}:*`);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
});

test("provider rotation cannot burst the same sender domain", async () => {
  const user = crypto.randomUUID();
  users.push(user);
  const providers = [
    candidate(
      "p1",
      rateGroup(user, "resend", "sender@example.com", "us-east-1"),
    ),
    candidate(
      "p2",
      rateGroup(user, "mailgun", "other@example.com", "eu-west-1"),
    ),
  ];
  assert.notEqual(providers[0].group, providers[1].group);

  const firstToken = crypto.randomUUID();
  const first = await acquireProvider(user, providers, firstToken, providers, true);
  assert(first);
  await releaseProvider(
    user,
    providers.find((p) => p.id === first)!,
    firstToken,
  );

  const immediate = await acquireProvider(
    user,
    providers,
    crypto.randomUUID(),
    providers,
    true,
  );
  assert.equal(immediate, null);
});

test("independent sender domains keep independent pacing clocks", async () => {
  const user = crypto.randomUUID();
  users.push(user);
  const one = candidate(
    "p1",
    rateGroup(user, "resend", "sender@example.com", "us-east-1"),
  );
  const two = candidate(
    "p2",
    rateGroup(user, "mailgun", "sender@other.example", "eu-west-1"),
  );

  const firstToken = crypto.randomUUID();
  assert.equal(await acquireProvider(user, [one], firstToken, [one], true), "p1");
  await releaseProvider(user, one, firstToken);

  const secondToken = crypto.randomUUID();
  assert.equal(await acquireProvider(user, [two], secondToken, [two], true), "p2");
  await releaseProvider(user, two, secondToken);
});

test("adaptive provider slowdown stretches the provider pacing gap", async () => {
  const user = crypto.randomUUID();
  users.push(user);
  const one = {
    ...candidate(
      "p1",
      rateGroup(user, "resend", "sender@example.com", "us-east-1"),
    ),
    perSecond: 1000,
    perMinute: 600,
  };
  await redis.set(providerAdaptiveKey(user, one.id), "4", "EX", 60);

  const token = crypto.randomUUID();
  assert.equal(await acquireProvider(user, [one], token, [one], true), "p1");
  await releaseProvider(user, one, token);

  const next = Number(await redis.get(`dispatch:${user}:${one.id}:next`));
  const [seconds, micros] = await redis.time();
  const redisNow = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  assert(next - redisNow >= 250);
});

test("high-rate sender domains soft-start after idle and persist warm progress", async () => {
  const user = crypto.randomUUID();
  users.push(user);
  const one = {
    ...candidate(
      "p1",
      rateGroup(user, "resend", "sender@example.com", "us-east-1"),
    ),
    perSecond: 1000,
    perMinute: 600,
  };
  const pacingGroup = one.group.split(".")[1];
  const warm = senderDomainWarmKeys(user, pacingGroup);

  const token = crypto.randomUUID();
  assert.equal(await acquireProvider(user, [one], token, [one], true), "p1");
  await releaseProvider(user, one, token);

  assert.equal(Number(await redis.get(warm.count)), 1);
  assert(Number(await redis.get(warm.last)) > 0);
  const next = Number(
    await redis.get(`dispatch:${user}:p:${pacingGroup}:next`),
  );
  const [seconds, micros] = await redis.time();
  const redisNow = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  assert(next - redisNow >= 250);
});
