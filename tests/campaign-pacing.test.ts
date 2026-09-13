import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCampaignPacing } from "@emailsystem/core/campaign-pacing";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000);

test("campaign pacing is complete when no work remains", () => {
  assert.deepEqual(deriveCampaignPacing([], 0, NOW), {
    status: "complete",
    sampleSize: 0,
    remaining: 0,
    messagesPerMinute: null,
    estimatedSeconds: 0,
    observedSeconds: 0,
    idleSeconds: null,
  });
});

test("campaign pacing waits before the first transmitted attempt", () => {
  const pacing = deriveCampaignPacing([], 100, NOW);
  assert.equal(pacing.status, "waiting");
  assert.equal(pacing.messagesPerMinute, null);
  assert.equal(pacing.estimatedSeconds, null);
});

test("campaign pacing estimates from recent observed transmission rate", () => {
  const pacing = deriveCampaignPacing(
    [secondsAgo(20), secondsAgo(15), secondsAgo(10), secondsAgo(5)],
    120,
    NOW,
  );
  assert.equal(pacing.status, "active");
  assert.equal(pacing.sampleSize, 4);
  assert.equal(pacing.messagesPerMinute, 12);
  assert.equal(pacing.estimatedSeconds, 600);
});

test("campaign pacing does not present a stale ETA while dispatch is idle", () => {
  const pacing = deriveCampaignPacing(
    [secondsAgo(120), secondsAgo(90), secondsAgo(60)],
    50,
    NOW,
  );
  assert.equal(pacing.status, "waiting");
  assert.equal(pacing.messagesPerMinute, 1.5);
  assert.equal(pacing.estimatedSeconds, null);
  assert.equal(pacing.idleSeconds, 60);
});

test("campaign pacing with too little evidence stays in estimating state", () => {
  const pacing = deriveCampaignPacing(
    [secondsAgo(5), secondsAgo(1)],
    50,
    NOW,
  );
  assert.equal(pacing.status, "estimating");
  assert.equal(pacing.estimatedSeconds, null);
});
