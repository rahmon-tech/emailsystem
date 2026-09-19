import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  authenticateWebhook,
  normalizeWebhook,
} from "../packages/providers/src/webhooks";
import { connection } from "./fixtures";
test("Resend verification authenticates raw bytes and rejects timestamp replay", async () => {
  const c = connection("resend");
  const secret = Buffer.alloc(32, 7);
  c.credentials.webhookSecret = "whsec_" + secret.toString("base64");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = '{"type":"email.delivered","data":{"email_id":"m1"}}';
  const sig = createHmac("sha256", secret)
    .update("id1." + timestamp + "." + raw)
    .digest("base64");
  const h = new Headers({
    "svix-id": "id1",
    "svix-timestamp": timestamp,
    "svix-signature": "v1," + sig,
  });
  assert(
    await authenticateWebhook(c, raw, h, new URL("https://example.com/h")),
  );
  assert.equal(
    await authenticateWebhook(
      c,
      raw + " ",
      h,
      new URL("https://example.com/h"),
    ),
    false,
  );
  h.set("svix-timestamp", "1");
  assert.equal(
    await authenticateWebhook(c, raw, h, new URL("https://example.com/h")),
    false,
  );
});
test("native event normalization keeps acceptance distinct from delivery", () => {
  assert.equal(
    normalizeWebhook(
      "resend",
      { type: "email.sent", data: { email_id: "m", to: ["a@example.com"] } },
      "id",
    )[0].kind,
    "accepted",
  );
  assert.equal(
    normalizeWebhook(
      "smtp2go",
      {
        event: "bounce",
        bounce: "soft",
        email_id: "m",
        rcpt: "a@example.com",
        id: "e",
        time: 100,
      },
      "id",
    )[0].kind,
    "soft_bounce",
  );
  assert.equal(
    normalizeWebhook(
      "postmark",
      {
        RecordType: "SpamComplaint",
        MessageID: "m",
        Recipient: "a@example.com",
        ID: 1,
      },
      "id",
    )[0].kind,
    "complaint",
  );
});

test("provider webhook failures and current event names normalize safely", () => {
  const cases: {
    type: Parameters<typeof normalizeWebhook>[0];
    payload: unknown;
    kind: string;
  }[] = [
    {
      type: "resend",
      payload: {
        type: "email.failed",
        created_at: new Date().toISOString(),
        data: { email_id: "resend-failed", to: ["a@example.com"] },
      },
      kind: "failed",
    },
    {
      type: "mailgun",
      payload: {
        "event-data": {
          event: "temporary_fail",
          id: "mailgun-temp",
          recipient: "a@example.com",
          timestamp: Date.now() / 1000,
          message: { headers: { "message-id": "mailgun-message" } },
        },
      },
      kind: "deferred",
    },
    {
      type: "mailgun",
      payload: {
        "event-data": {
          event: "permanent_fail",
          id: "mailgun-hard",
          recipient: "a@example.com",
          timestamp: Date.now() / 1000,
          message: { headers: { "message-id": "mailgun-message-2" } },
        },
      },
      kind: "hard_bounce",
    },
    {
      type: "sendgrid",
      payload: {
        event: "dropped",
        sg_message_id: "sendgrid-message",
        sg_event_id: "sendgrid-drop",
        email: "a@example.com",
        timestamp: Math.floor(Date.now() / 1000),
      },
      kind: "failed",
    },
    {
      type: "brevo",
      payload: {
        event: "blocked",
        "message-id": "brevo-message",
        id: "brevo-blocked",
        email: "a@example.com",
        ts_event: Math.floor(Date.now() / 1000),
      },
      kind: "failed",
    },
    {
      type: "mailjet",
      payload: {
        event: "blocked",
        MessageID: "mailjet-message",
        email: "a@example.com",
        time: Math.floor(Date.now() / 1000),
      },
      kind: "failed",
    },
    {
      type: "smtp2go",
      payload: {
        event: "reject",
        email_id: "smtp2go-message",
        rcpt: "a@example.com",
        id: "smtp2go-reject",
        time: Math.floor(Date.now() / 1000),
      },
      kind: "failed",
    },
    {
      type: "smtp",
      payload: {
        event: "rejected",
        messageId: "smtp-message",
        recipient: "a@example.com",
        eventId: "smtp-reject",
        timestamp: new Date().toISOString(),
      },
      kind: "failed",
    },
  ];

  for (const entry of cases) {
    const events = normalizeWebhook(entry.type, entry.payload, "request");
    assert.equal(events.length, 1, entry.type);
    assert.equal(events[0].kind, entry.kind, entry.type);
  }
});

test("Mailgun authenticates timestamp/token and SendGrid authenticates exact raw bytes", async () => {
  const c = connection("mailgun");
  c.credentials.webhookSecret = "test-signing-key";
  const timestamp = String(Math.floor(Date.now() / 1000)),
    token = "unique-notification";
  const signature = createHmac("sha256", c.credentials.webhookSecret)
    .update(timestamp + token)
    .digest("hex");
  const raw = JSON.stringify({
    signature: { timestamp, token, signature },
    "event-data": { event: "delivered" },
  });
  assert(
    await authenticateWebhook(
      c,
      raw,
      new Headers(),
      new URL("https://example.com/hook"),
    ),
  );
  assert(
    !(await authenticateWebhook(
      c,
      raw.replace(token, "tampered"),
      new Headers(),
      new URL("https://example.com/hook"),
    )),
  );
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const sg = connection("sendgrid");
  sg.credentials.webhookPublicKey = pair.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const body = '[{"event":"delivered"}]';
  const headers = new Headers({
    "x-twilio-email-event-webhook-timestamp": timestamp,
    "x-twilio-email-event-webhook-signature": sign(
      "sha256",
      Buffer.from(timestamp + body),
      pair.privateKey,
    ).toString("base64"),
  });
  assert(
    await authenticateWebhook(
      sg,
      body,
      headers,
      new URL("https://example.com/hook"),
    ),
  );
  assert(
    !(await authenticateWebhook(
      sg,
      body + " ",
      headers,
      new URL("https://example.com/hook"),
    )),
  );
});
test("SES multi-recipient notifications preserve each recipient and distinct deduplication keys", () => {
  const events = normalizeWebhook(
    "ses",
    {
      Type: "Notification",
      MessageId: "sns-1",
      Message: JSON.stringify({
        notificationType: "Bounce",
        mail: {
          messageId: "ses-1",
          timestamp: new Date().toISOString(),
          destination: ["one@example.net", "copy@example.net"],
        },
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [
            { emailAddress: "one@example.net" },
            { emailAddress: "copy@example.net" },
          ],
        },
      }),
    },
    "request",
  );
  assert.equal(events.length, 2);
  assert.notEqual(events[0].eventKey, events[1].eventKey);
  assert.equal(events[1].recipient, "copy@example.net");
  assert(events.every((e) => e.kind === "hard_bounce"));
});
test("SMTP2GO correlates authenticated native RFC message ID with the original attempt", () => {
  const id = "13c4b3e5-f53b-4ba3-a015-3c42f46c037a";
  const [event] = normalizeWebhook(
    "smtp2go",
    {
      event: "delivered",
      email_id: "smtp2go-internal",
      rcpt: "recipient@example.com",
      "message-id": `<${id}@example.com>`,
      time: new Date().toISOString(),
    },
    "r",
  );
  assert.equal(event.attemptId, id);
});

test("Custom SMTP accepts authenticated generic delivery callbacks", async () => {
  const c = connection("smtp");
  c.credentials.webhookSecret = "custom-delivery-secret";
  const authorization =
    "Basic " +
    Buffer.from("emailsystem:" + c.credentials.webhookSecret).toString("base64");
  const raw = JSON.stringify({
    event: "delivered",
    messageId: "smtp-message-1",
    recipient: "person@example.net",
    eventId: "delivery-event-1",
    attemptId: "13c4b3e5-f53b-4ba3-a015-3c42f46c037a",
    timestamp: new Date().toISOString(),
  });
  assert.equal(
    await authenticateWebhook(
      c,
      raw,
      new Headers({ authorization }),
      new URL("https://example.com/api/webhooks/provider"),
    ),
    true,
  );
  assert.equal(
    await authenticateWebhook(
      c,
      raw,
      new Headers({ authorization: "Basic bad" }),
      new URL("https://example.com/api/webhooks/provider"),
    ),
    false,
  );
  const [event] = normalizeWebhook("smtp", JSON.parse(raw), "request");
  assert.equal(event.kind, "delivered");
  assert.equal(event.messageId, "smtp-message-1");
  assert.equal(event.recipient, "person@example.net");
  assert.equal(event.attemptId, "13c4b3e5-f53b-4ba3-a015-3c42f46c037a");
});
