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
