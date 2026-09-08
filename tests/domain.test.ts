import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transitionCampaign,
  deliveryAfterEvent,
  retryDecision,
} from "../packages/core/src/domain.ts";
test("campaign transitions are centralized and terminal campaigns cannot resume", () => {
  assert.equal(transitionCampaign("QUEUED", "pause"), "PAUSED");
  assert.equal(transitionCampaign("PAUSED", "resume"), "QUEUED");
  assert.throws(() => transitionCampaign("COMPLETED", "resume"));
  assert.throws(() => transitionCampaign("DRAFT", "resume"));
});
test("late events cannot regress delivered or suppressed recipient truth", () => {
  assert.equal(deliveryAfterEvent("DELIVERED", "deferred"), "DELIVERED");
  assert.equal(deliveryAfterEvent("HARD_BOUNCED", "delivered"), "HARD_BOUNCED");
  assert.equal(deliveryAfterEvent("UNKNOWN", "delivered"), "DELIVERED");
  assert.equal(deliveryAfterEvent("DELIVERED", "complaint"), "COMPLAINED");
  assert.equal(deliveryAfterEvent("CANCELLED", "delivered"), "CANCELLED");
});
test("unknown and policy failures never automatically fail over; retries are bounded", () => {
  assert.deepEqual(retryDecision("unknown", 1), "reconcile");
  assert.deepEqual(retryDecision("policy", 1), "block");
  assert.equal(retryDecision("temporary", 5), "fail");
  assert.equal(retryDecision("permanent", 1), "fail");
  assert.equal(typeof retryDecision("rate_limit", 1), "number");
});
