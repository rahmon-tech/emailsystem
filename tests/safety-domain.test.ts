import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignSendingDomains, domainBounceReason } from "../packages/core/src/safety-domain";
import { safetySettings } from "../packages/core/src/safety-config";

test("new accounts isolate bounce thresholds by sending domain by default", () => {
  assert.equal(safetySettings.parse({}).brakeScope, "domain");
  assert.equal(safetySettings.parse({ brakeScope: "account" }).brakeScope, "account");
});
test("a multi-domain campaign lists all potential From domains without recipients' domains", () => {
  assert.deepEqual(
    campaignSendingDomains({
      from: "hello@FIRST.example",
      cc: ["customer@recipient.example"],
      senderPool: { domains: ["FIRST.example", "SECOND.example", "first.example"] },
    }),
    ["first.example", "second.example"],
  );
  assert.deepEqual(campaignSendingDomains(null), []);
  assert.deepEqual(campaignSendingDomains({ from: "No email" }), []);
  assert.match(domainBounceReason("first.example", "hard_bounce"), /first.example/);
});
