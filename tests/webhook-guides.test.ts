import test from "node:test";
import assert from "node:assert/strict";
import { webhookSetupGuide } from "../packages/providers/src/webhook-guides";

test("provider webhook guides expose the events EmailBlast expects users to configure", () => {
  assert.deepEqual(webhookSetupGuide("resend").events, [
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.failed",
    "email.opened",
    "email.clicked",
  ]);
  assert(webhookSetupGuide("sendgrid").events.includes("dropped"));
  assert(webhookSetupGuide("mailgun").events.includes("temporary_fail"));
  assert(webhookSetupGuide("mailgun").events.includes("permanent_fail"));
  assert(webhookSetupGuide("brevo").events.includes("Blocked"));
  assert(webhookSetupGuide("mailjet").events.includes("blocked"));
  assert(webhookSetupGuide("smtp2go").events.includes("reject"));
  assert(webhookSetupGuide("elastic").events.includes("Bounce / Error"));
});

test("Postmark setup follows the selected message stream", () => {
  const broadcast = webhookSetupGuide("postmark", {
    messageStreamType: "broadcast",
  });
  assert.deepEqual(broadcast.events, [
    "Delivery",
    "Open",
    "Click",
    "Subscription Change",
  ]);
  assert.match(broadcast.note ?? "", /Broadcast Message Streams/);

  const transactional = webhookSetupGuide("postmark", {
    messageStreamType: "transactional",
  });
  assert(transactional.events.includes("Bounce"));
  assert(transactional.events.includes("Spam Complaint"));
});

test("Custom SMTP clearly requires a callback-capable SMTP service", () => {
  const guide = webhookSetupGuide("smtp");
  assert.match(guide.steps.join(" "), /Plain SMTP does not provide final delivery callbacks/);
  assert.match(guide.steps.join(" "), /Webhooks, Events, Delivery notifications or callbacks/);
  assert.match(guide.note ?? "", /provider-specific adapter/);
});
