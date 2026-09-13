import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rateGroup,
  senderDomainRateGroup,
} from "@emailsystem/core/dispatcher";

test("provider quota groups stay provider-specific while domain pacing stays shared", () => {
  const user = "user-1";
  const a = rateGroup(user, "resend", "Sender@Example.com", "us-east-1");
  const b = rateGroup(user, "mailgun", "other@example.com", "eu-west-1");
  const domainA = senderDomainRateGroup(user, "Sender@Example.com");
  const domainB = senderDomainRateGroup(user, "other@example.com");
  const domainC = senderDomainRateGroup(user, "third@other.example");

  assert.notEqual(a, b);
  assert.equal(domainA, domainB);
  assert.notEqual(domainA, domainC);
  assert(a.endsWith(`.${domainA}`));
  assert(b.endsWith(`.${domainB}`));
});

test("sender-domain pacing remains tenant-scoped", () => {
  const a = senderDomainRateGroup("user-a", "sender@example.com");
  const b = senderDomainRateGroup("user-b", "sender@example.com");
  assert.notEqual(a, b);
});
