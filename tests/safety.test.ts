import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safetySettings,
  messageCost,
  brakeDecision,
} from "@emailsystem/core/safety-config";

test("safety defaults are independent finite budgets with recipient-unit cost", () => {
  const s = safetySettings.parse({});
  assert.deepEqual(
    [s.accountDaily, s.domainDaily, s.providerDaily, s.campaignDaily],
    [10000, 5000, 5000, 5000],
  );
  assert.equal(messageCost({ cc: ["c1", "c2"], bcc: ["b1"] }), 4);
});
test("safety settings reject zero, negatives, NaN, infinity, fractional and overflow budgets", () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, 2147483648])
    for (const key of [
      "accountDaily",
      "domainDaily",
      "providerDaily",
      "campaignDaily",
    ])
      assert.equal(safetySettings.safeParse({ [key]: value }).success, false);
  assert.equal(
    safetySettings.parse({ campaignDaily: null }).campaignDaily,
    null,
  );
  assert.equal(safetySettings.safeParse({ accountDaily: null }).success, false);
});
test("brakes require meaningful samples and preserve complaint priority", () => {
  const s = safetySettings.parse({});
  assert.equal(
    brakeDecision(s, { sample: 99, complaints: 5, hardBounces: 10 }),
    null,
  );
  assert.equal(
    brakeDecision(s, { sample: 100, complaints: 0, hardBounces: 1 }),
    null,
  );
  assert.equal(
    brakeDecision(s, { sample: 100, complaints: 0, hardBounces: 2 }),
    "hard_bounce",
  );
  assert.equal(
    brakeDecision(s, { sample: 1000, complaints: 1, hardBounces: 0 }),
    "complaint",
  );
});
