import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyConnection, send } from "../packages/providers/src/index";
import { connection } from "./fixtures";
const responses: Record<string, unknown> = {
  resend: { data: [{ name: "example.com", status: "verified" }] },
  mailgun: { domain: { name: "example.com", state: "active" } },
  sendgrid: { scopes: ["mail.send"] },
  brevo: {
    relay: { enabled: true },
    plan: [{ type: "payAsYouGo", credits: 1000 }],
  },
  postmark: { ID: 123 },
  mailjet: {
    Messages: [{ Status: "success", To: [{ Email: "delivered@resend.dev" }] }],
  },
  smtp2go: { data: { delivered: 42 } },
  elastic: [{ Domain: "example.com" }],
};
for (const type of [
  "resend",
  "mailgun",
  "sendgrid",
  "brevo",
  "postmark",
  "mailjet",
  "smtp2go",
  "elastic",
] as const) {
  test(`${type} verification: real credential, documented probe and usable outcome`, async () => {
    const c = connection(type);
    const requests: {
      url: string;
      body?: BodyInit | null;
      headers?: HeadersInit;
    }[] = [];
    const v = await verifyConnection(c, {
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body,
          headers: init?.headers,
        });
        return Response.json(
          String(url).includes("/message-streams/")
            ? { MessageStreamType: "Broadcast" }
            : responses[type],
        );
      },
    });
    assert.equal(
      v.usable,
      ["resend", "sendgrid", "postmark", "mailjet"].includes(type),
    );
    assert(v.checks.length);
    assert(!JSON.stringify(v).includes("key-secret"));
    if (type === "postmark")
      assert.equal(
        new Headers(requests[0].headers).get("X-Postmark-Server-Token"),
        "token-secret",
      );
    if (type === "mailjet")
      assert.equal(JSON.parse(String(requests[0].body)).SandboxMode, true);
    if (type === "smtp2go")
      assert.match(requests[0].url, /stats\/email_summary$/);
  });
  test(`${type} verification: invalid credentials and read-scope denial stay distinct`, async () => {
    const c = connection(type);
    assert.equal(
      (
        await verifyConnection(c, {
          fetch: async () =>
            new Response('{"error":"api-key-secret"}', { status: 401 }),
        })
      ).status,
      "AUTH_ERROR",
    );
    const denied = await verifyConnection(c, {
      fetch: async () => new Response("{}", { status: 403 }),
    });
    assert.equal(denied.usable, false);
    assert.notEqual(denied.status, "AUTH_ERROR");
  });
}
test("Resend sending-only verification uses its safe recipient and unique idempotency key", async () => {
  const c = connection("resend");
  let recipient = "";
  let key = "";
  const v = await verifyConnection(c, {
    fetch: async (url, init) => {
      if (String(url).endsWith("/domains"))
        return new Response("{}", { status: 403 });
      recipient = JSON.parse(String(init?.body)).to[0];
      key = new Headers(init?.headers).get("Idempotency-Key") ?? "";
      return Response.json({ id: "safe-test-id" });
    },
  });
  assert.equal(v.usable, true);
  assert.equal(recipient, "delivered@resend.dev");
  assert(key.length > 30);
});
test("Resend unverified domain and SendGrid missing mail.send require action", async () => {
  assert.equal(
    (
      await verifyConnection(connection("resend"), {
        fetch: async () =>
          Response.json({ data: [{ name: "example.com", status: "pending" }] }),
      })
    ).status,
    "DOMAIN_UNVERIFIED",
  );
  assert.equal(
    (
      await verifyConnection(connection("sendgrid"), {
        fetch: async () => Response.json({ scopes: ["stats.read"] }),
      })
    ).status,
    "MISSING_PERMISSION",
  );
});
test("Postmark rejects a transactional stream for campaigns", async () => {
  assert.equal(
    (
      await verifyConnection(connection("postmark"), {
        fetch: async (url) =>
          Response.json(
            String(url).includes("/message-streams/")
              ? { MessageStreamType: "Transactional" }
              : { ID: 1 },
          ),
      })
    ).status,
    "CONFIG_ERROR",
  );
});
test("SES quota exhaustion is reported separately from credential failure", async () => {
  const v = await verifyConnection(connection("ses"), {
    ses: {
      send: async (c) =>
        (c as object).constructor.name === "GetAccountCommand"
          ? {
              SendingEnabled: true,
              ProductionAccessEnabled: true,
              SendQuota: {
                Max24HourSend: 100,
                SentLast24Hours: 100,
                MaxSendRate: 14,
              },
            }
          : { VerifiedForSendingStatus: true },
    },
  });
  assert.equal(v.status, "THROTTLED");
  assert.equal(v.usable, false);
});
test("Mailjet native sandbox succeeds without inventing a provider message ID", async () => {
  const c = connection("mailjet");
  const result = await send(
    c,
    {
      from: "sender@example.com",
      fromName: "",
      to: "test@example.net",
      replyTo: "",
      cc: [],
      bcc: [],
      subject: "Sandbox",
      html: "<p>Test</p>",
      text: "Test",
      headers: {},
      attachments: [],
    },
    { attemptId: "a", idempotencyKey: "i", testMode: true },
    {
      fetch: async () =>
        Response.json({
          Messages: [
            {
              Status: "success",
              To: [
                { Email: "test@example.net", MessageUUID: "", MessageID: 0 },
              ],
            },
          ],
        }),
    },
  );
  assert.equal(result.status, "accepted");
  assert.equal(result.providerMessageId, null);
});
