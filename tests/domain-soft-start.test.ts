import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_SOFT_START_IDLE_MS,
  domainSoftStartSlowdown,
} from "@emailsystem/core/domain-soft-start";
import { safetySettings } from "@emailsystem/core/safety-config";

test("existing safety settings default to balanced warm-up without new pacing ceilings", () => {
  const settings = safetySettings.parse({});
  assert.equal(settings.warmupProfile, "balanced");
  assert.equal(settings.accountPerMinute, null);
  assert.equal(settings.domainPerMinute, null);
  assert.equal(settings.campaignPerMinute, null);
});

test("ordinary low-rate sending is not slowed by balanced soft start", () => {
  assert.equal(domainSoftStartSlowdown(30, 0, null, "balanced"), 1);
  assert.equal(domainSoftStartSlowdown(60, 0, null, "balanced"), 1);
});

test("balanced high-rate domains preserve the verified ramp", () => {
  assert.equal(domainSoftStartSlowdown(120, 0, null, "balanced"), 4);
  assert.equal(domainSoftStartSlowdown(120, 4, 1000, "balanced"), 4);
  assert.equal(domainSoftStartSlowdown(120, 5, 1000, "balanced"), 2);
  assert.equal(domainSoftStartSlowdown(120, 14, 1000, "balanced"), 2);
  assert.equal(domainSoftStartSlowdown(120, 15, 1000, "balanced"), 1.25);
  assert.equal(domainSoftStartSlowdown(120, 29, 1000, "balanced"), 1.25);
  assert.equal(domainSoftStartSlowdown(120, 30, 1000, "balanced"), 1);
});

test("conservative warm-up starts earlier and recovers more gradually", () => {
  assert.equal(domainSoftStartSlowdown(60, 0, null, "conservative"), 6);
  assert.equal(domainSoftStartSlowdown(60, 9, 1000, "conservative"), 6);
  assert.equal(domainSoftStartSlowdown(60, 10, 1000, "conservative"), 3);
  assert.equal(domainSoftStartSlowdown(60, 30, 1000, "conservative"), 1.5);
  assert.equal(domainSoftStartSlowdown(60, 60, 1000, "conservative"), 1);
});

test("high-capacity profile keeps a bounded soft start without raising configured limits", () => {
  assert.equal(domainSoftStartSlowdown(120, 0, null, "high_capacity"), 1);
  assert.equal(domainSoftStartSlowdown(240, 0, null, "high_capacity"), 2);
  assert.equal(domainSoftStartSlowdown(240, 5, 1000, "high_capacity"), 1.5);
  assert.equal(domainSoftStartSlowdown(240, 15, 1000, "high_capacity"), 1.25);
  assert.equal(domainSoftStartSlowdown(240, 30, 1000, "high_capacity"), 1);
});

test("a warmed domain soft-starts again after meaningful inactivity", () => {
  assert.equal(
    domainSoftStartSlowdown(
      600,
      200,
      DOMAIN_SOFT_START_IDLE_MS + 1,
      "balanced",
    ),
    4,
  );
});
