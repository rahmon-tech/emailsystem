import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAdaptivePacing } from "@emailsystem/core/pacing-policy";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const attempt = (
  secondsAgo: number,
  state: string,
  category: string | null = null,
) => ({
  state,
  category,
  finishedAt: new Date(NOW - secondsAgo * 1000),
});

test("healthy accepted history keeps configured pacing unchanged", () => {
  const decision = deriveAdaptivePacing(
    Array.from({ length: 20 }, (_, i) => attempt(i + 1, "ACCEPTED")),
    NOW,
  );
  assert.equal(decision.slowdown, 1);
  assert.equal(decision.cooldownUntil, null);
  assert.equal(decision.transientCount, 0);
});

test("recent rate limits extend cooldown and reduce the provider's effective pace", () => {
  const one = deriveAdaptivePacing(
    [attempt(1, "REJECTED", "rate_limit")],
    NOW,
  );
  const three = deriveAdaptivePacing(
    [
      attempt(1, "REJECTED", "rate_limit"),
      attempt(2, "REJECTED", "rate_limit"),
      attempt(3, "REJECTED", "rate_limit"),
    ],
    NOW,
  );
  assert(one.slowdown > 1);
  assert(three.slowdown > one.slowdown);
  assert.equal(one.cooldownUntil?.getTime(), NOW - 1000 + 30_000);
  assert.equal(three.cooldownUntil?.getTime(), NOW - 1000 + 120_000);
});

test("temporary failures back off without treating permanent errors as throttling", () => {
  const temporary = deriveAdaptivePacing(
    [
      attempt(1, "REJECTED", "temporary"),
      attempt(2, "REJECTED", "temporary"),
    ],
    NOW,
  );
  const permanent = deriveAdaptivePacing(
    [attempt(1, "REJECTED", "permanent")],
    NOW,
  );
  assert(temporary.slowdown > 1);
  assert.equal(temporary.cooldownUntil?.getTime(), NOW - 1000 + 30_000);
  assert.equal(permanent.slowdown, 1);
  assert.equal(permanent.cooldownUntil, null);
});

test("old transient failures age out of the adaptive window", () => {
  const decision = deriveAdaptivePacing(
    [attempt(16 * 60, "REJECTED", "rate_limit")],
    NOW,
  );
  assert.deepEqual(decision, {
    slowdown: 1,
    cooldownUntil: null,
    sampleSize: 0,
    transientCount: 0,
    consecutiveTransient: 0,
  });
});
