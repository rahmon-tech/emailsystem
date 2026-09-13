import { test } from "node:test";
import assert from "node:assert/strict";
import { rateGroup } from "@emailsystem/core/dispatcher";

test("rate group is provider-independent for the same sender domain", () => {
  const user = "user-1";
  const a = rateGroup(user, "resend", "Sender@Example.com", "us-east-1");
  const b = rateGroup(user, "mailgun", "other@example.com", "eu-west-1");
  const c = rateGroup(user, "sendgrid", "third@other.example", "");

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("rate group remains tenant-scoped", () => {
  const a = rateGroup("user-a", "resend", "sender@example.com");
  const b = rateGroup("user-b", "resend", "sender@example.com");
  assert.notEqual(a, b);
});
