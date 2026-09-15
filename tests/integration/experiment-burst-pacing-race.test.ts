import { after, test } from "node:test";
import assert from "node:assert/strict";
import { redis } from "@emailsystem/core/redis";
import {
  acquireExperimentBurstPacing,
  commitExperimentBurstPacing,
  readExperimentBurstPacingEvidence,
  releaseExperimentBurstPacing,
} from "@emailsystem/core/experiment-burst-pacing";

const users: string[] = [];

after(async () => {
  for (const userId of users) {
    const keys = await redis.keys(`dispatch:${userId}:*`);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
});

test("bounded burst pacing is atomic across concurrent callers and releases only unstarted owner reservations", async () => {
  const userId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  users.push(userId);
  const tokens = Array.from({ length: 24 }, () => crypto.randomUUID());

  const permits = await Promise.all(
    tokens.map((token) =>
      acquireExperimentBurstPacing(userId, runId, token, 60_000, 3),
    ),
  );
  const winners = permits
    .map((permit, index) => ({ permit, token: tokens[index]! }))
    .filter(({ permit }) => permit.allowed);
  assert.equal(winners.length, 3);
  assert.deepEqual(
    winners
      .map(({ permit }) => permit.occupancyBeforeStart)
      .sort((a, b) => a - b),
    [0, 1, 2],
  );

  for (const { permit, token } of winners) {
    assert.equal(
      await commitExperimentBurstPacing(userId, runId, token, {
        windowMs: 60_000,
        burstSize: 3,
        occupancyBeforeStart: permit.occupancyBeforeStart,
        occupancyAfterStart: permit.occupancyAfterStart,
      }),
      true,
    );
    assert.deepEqual(await readExperimentBurstPacingEvidence(userId, runId, token), {
      profile: "bounded-burst",
      windowMs: 60_000,
      burstSize: 3,
      occupancyBeforeStart: permit.occupancyBeforeStart,
      occupancyAfterStart: permit.occupancyAfterStart,
    });
  }

  const blocked = await acquireExperimentBurstPacing(
    userId,
    runId,
    crypto.randomUUID(),
    60_000,
    3,
  );
  assert.equal(blocked.allowed, false);
  const [seconds, micros] = await redis.time();
  const redisNow = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  assert(blocked.nextAllowedAt > redisNow);
  assert.equal(
    await releaseExperimentBurstPacing(userId, runId, winners[0]!.token),
    false,
    "a committed transport start cannot be released from the window",
  );

  const releasableRun = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const reserved = await acquireExperimentBurstPacing(
    userId,
    releasableRun,
    owner,
    60_000,
    1,
  );
  assert.equal(reserved.allowed, true);
  assert.equal(
    await releaseExperimentBurstPacing(userId, releasableRun, crypto.randomUUID()),
    false,
  );
  assert.equal(
    await releaseExperimentBurstPacing(userId, releasableRun, owner),
    true,
  );
  const replacement = await acquireExperimentBurstPacing(
    userId,
    releasableRun,
    crypto.randomUUID(),
    60_000,
    1,
  );
  assert.equal(replacement.allowed, true);
});
