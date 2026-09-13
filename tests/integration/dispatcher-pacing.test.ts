import { test, after } from "node:test";
import assert from "node:assert/strict";
import { redis } from "@emailsystem/core/redis";
import {
  acquireProvider,
  releaseProvider,
  rateGroup,
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
  const group = rateGroup(user, "resend", "sender@example.com", "us-east-1");
  const providers = [candidate("p1", group), candidate("p2", group)];

  const firstToken = crypto.randomUUID();
  const first = await acquireProvider(user, providers, firstToken, providers);
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
  assert.equal(await acquireProvider(user, [one], firstToken, [one]), "p1");
  await releaseProvider(user, one, firstToken);

  const secondToken = crypto.randomUUID();
  assert.equal(await acquireProvider(user, [two], secondToken, [two]), "p2");
  await releaseProvider(user, two, secondToken);
});
