import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_SOFT_START_IDLE_MS,
  domainSoftStartSlowdown,
} from "@emailsystem/core/domain-soft-start";

test("ordinary low-rate sending is not slowed by soft start", () => {
  assert.equal(domainSoftStartSlowdown(30, 0, null), 1);
  assert.equal(domainSoftStartSlowdown(60, 0, null), 1);
});

test("high-rate domains ramp gradually after idle", () => {
  assert.equal(domainSoftStartSlowdown(120, 0, null), 4);
  assert.equal(domainSoftStartSlowdown(120, 4, 1000), 4);
  assert.equal(domainSoftStartSlowdown(120, 5, 1000), 2);
  assert.equal(domainSoftStartSlowdown(120, 14, 1000), 2);
  assert.equal(domainSoftStartSlowdown(120, 15, 1000), 1.25);
  assert.equal(domainSoftStartSlowdown(120, 29, 1000), 1.25);
  assert.equal(domainSoftStartSlowdown(120, 30, 1000), 1);
});

test("a high-rate domain soft-starts again after meaningful inactivity", () => {
  assert.equal(
    domainSoftStartSlowdown(600, 200, DOMAIN_SOFT_START_IDLE_MS + 1),
    4,
  );
});
