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

test("configured warm-up profile changes only the domain soft-start gap", async () => {
  const make = (user: string, id: string) => ({
    ...candidate(
      id,
      rateGroup(user, "resend", "sender@example.com", "us-east-1"),
    ),
    perSecond: 1000,
    perMinute: 120,
  });

  const balancedUser = crypto.randomUUID();
  users.push(balancedUser);
  const balanced = make(balancedUser, "balanced");
  const balancedToken = crypto.randomUUID();
  assert.equal(
    await acquireProvider(
      balancedUser,
      [balanced],
      balancedToken,
      [balanced],
      true,
      "balanced",
    ),
    "balanced",
  );
  await releaseProvider(balancedUser, balanced, balancedToken);
  const balancedGroup = balanced.group.split(".")[1];
  const balancedNext = Number(
    await redis.get(`dispatch:${balancedUser}:p:${balancedGroup}:next`),
  );
  const [balancedSeconds, balancedMicros] = await redis.time();
  const balancedNow =
    Number(balancedSeconds) * 1000 + Math.floor(Number(balancedMicros) / 1000);

  const highUser = crypto.randomUUID();
  users.push(highUser);
  const high = make(highUser, "high");
  const highToken = crypto.randomUUID();
  assert.equal(
    await acquireProvider(
      highUser,
      [high],
      highToken,
      [high],
      true,
      "high_capacity",
    ),
    "high",
  );
  await releaseProvider(highUser, high, highToken);
  const highGroup = high.group.split(".")[1];
  const highNext = Number(
    await redis.get(`dispatch:${highUser}:p:${highGroup}:next`),
  );
  const [highSeconds, highMicros] = await redis.time();
  const highNow = Number(highSeconds) * 1000 + Math.floor(Number(highMicros) / 1000);

  assert(balancedNext - balancedNow >= 1900);
  assert(highNext - highNow < 1000);
});

test("account pacing ceiling coordinates independent sender domains", async () => {
  const user = crypto.randomUUID();
  users.push(user);
  const one = {
    ...candidate(
      "p1",
      rateGroup(user, "resend", "sender@one.example", "us-east-1"),
    ),
    perSecond: 1000,
    perMinute: 600,
  };
  const two = {
    ...candidate(
      "p2",
      rateGroup(user, "mailgun", "sender@two.example", "eu-west-1"),
    ),
    perSecond: 1000,
    perMinute: 600,
  };
  const policy = {
    accountPerMinute: 60,
    domainPerMinute: null,
    campaignId: "campaign-a",
    campaignPerMinute: null,
  };

  const token = crypto.randomUUID();
  assert.equal(
    await acquireProvider(user, [one], token, [one], true, "high_capacity", policy),
    "p1",
  );
  await releaseProvider(user, one, token);
  assert.equal(
    await acquireProvider(
      user,
      [two],
      crypto.randomUUID(),
      [two],
      true,
      "high_capacity",
      policy,
    ),
    null,
  );
});

test("configured domain ceiling can be lower than provider-derived capacity", async () => {
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
  const token = crypto.randomUUID();
  assert.equal(
    await acquireProvider(
      user,
      [one],
      token,
      [one],
      true,
      "high_capacity",
      {
        accountPerMinute: null,
        domainPerMinute: 60,
        campaignId: "campaign-a",
        campaignPerMinute: null,
      },
    ),
    "p1",
  );
  await releaseProvider(user, one, token);
  const next = Number(
    await redis.get(`dispatch:${user}:p:${pacingGroup}:next`),
  );
  const [seconds, micros] = await redis.time();
  const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  assert(next - now >= 900);
});

test("campaign pacing ceiling is isolated by campaign", async () => {
  const user = crypto.randomUUID();
  users.push(user);
  const one = {
    ...candidate(
      "p1",
      rateGroup(user, "resend", "sender@one.example", "us-east-1"),
    ),
    perSecond: 1000,
    perMinute: 600,
  };
  const two = {
    ...candidate(
      "p2",
      rateGroup(user, "mailgun", "sender@two.example", "eu-west-1"),
    ),
    perSecond: 1000,
    perMinute: 600,
  };
  const firstToken = crypto.randomUUID();
  assert.equal(
    await acquireProvider(user, [one], firstToken, [one], true, "high_capacity", {
      accountPerMinute: null,
      domainPerMinute: null,
      campaignId: "campaign-a",
      campaignPerMinute: 60,
    }),
    "p1",
  );
  await releaseProvider(user, one, firstToken);

  assert.equal(
    await acquireProvider(
      user,
      [two],
      crypto.randomUUID(),
      [two],
      true,
      "high_capacity",
      {
        accountPerMinute: null,
        domainPerMinute: null,
        campaignId: "campaign-a",
        campaignPerMinute: 60,
      },
    ),
    null,
  );

  const otherToken = crypto.randomUUID();
  assert.equal(
    await acquireProvider(
      user,
      [two],
      otherToken,
      [two],
      true,
      "high_capacity",
      {
        accountPerMinute: null,
        domainPerMinute: null,
        campaignId: "campaign-b",
        campaignPerMinute: 60,
      },
    ),
    "p2",
  );
  await releaseProvider(user, two, otherToken);
});
