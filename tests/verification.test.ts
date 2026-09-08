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
  test(`${type} verification: supplied credential, documented probe and usable outcome`, async () => {
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
            : type === "brevo" && String(url).endsWith("/smtp/email")
              ? { messageId: "sandbox-id" }
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
test("Resend sending-only Save & Verify never sends email", async () => {
  for (const [status, name] of [
    [401, "restricted_api_key"],
    [403, "unknown"],
  ] as const) {
    const methods: string[] = [];
    const v = await verifyConnection(connection("resend"), {
      fetch: async (url, init) => {
        assert.equal(url, "https://api.resend.com/domains");
        methods.push(init?.method ?? "GET");
        return Response.json({ name }, { status });
      },
    });
    assert.equal(v.usable, false);
    assert.equal(v.status, "UNVERIFIED");
    assert.deepEqual(methods, ["GET"]);
  }
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

test("Resend invalid keys are classified from the documented error name", async () => {
  const v = await verifyConnection(connection("resend"), {
    fetch: async () =>
      Response.json(
        { name: "invalid_api_key", message: "token-secret" },
        { status: 403 },
      ),
  });
  assert.equal(v.status, "AUTH_ERROR");
  assert(!JSON.stringify(v).includes("token-secret"));
});
test("Brevo account plus sandbox validates format without establishing send permission", async () => {
  const methods: string[] = [];
  const v = await verifyConnection(connection("brevo"), {
    fetch: async (url, init) => {
      methods.push(init?.method ?? "GET");
      if (String(url).endsWith("/account"))
        return Response.json({ relay: { enabled: true } });
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.headers["X-Sib-Sandbox"], "drop");
      assert.deepEqual(payload.to, [{ email: "sender@example.com" }]);
      assert.equal(new Headers(init?.headers).get("X-Sib-Sandbox"), null);
      return Response.json({ messageId: "sandbox-id" }, { status: 201 });
    },
  });
  assert.equal(v.status, "UNVERIFIED");
  assert.equal(v.usable, false);
  assert.deepEqual(methods, ["GET", "POST"]);
  assert(
    v.checks.some((c) => c.name === "Sandbox format" && c.status === "passed"),
  );
});
test("SES enforcement shutdown blocks sending even with contradictory SendingEnabled", async () => {
  const v = await verifyConnection(connection("ses"), {
    ses: {
      send: async () => ({
        SendingEnabled: true,
        EnforcementStatus: "SHUTDOWN",
      }),
    },
  });
  assert.equal(v.status, "POLICY_BLOCKED");
  assert.equal(v.usable, false);
});
test("malformed successful API responses cannot enable a connection", async () => {
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
    const v = await verifyConnection(connection(type), {
      fetch: async () => new Response("not-json-secret", { status: 200 }),
    });
    assert.equal(v.usable, false);
    assert(!JSON.stringify(v).includes("not-json-secret"));
  }
});

test("Postmark sandbox servers cannot become campaign eligible", async () => {
  const v = await verifyConnection(connection("postmark"), {
    fetch: async () => Response.json({ ID: 123, DeliveryType: "Sandbox" }),
  });
  assert.equal(v.status, "SANDBOX");
  assert.equal(v.usable, false);
});

test("verification preserves rate limits and account enforcement guidance", async () => {
  for (const [status, data, expected] of [
    [429, { message: "Rate limit exceeded" }, "THROTTLED"],
    [
      403,
      { message: "Account suspended due to enforcement" },
      "POLICY_BLOCKED",
    ],
  ] as const) {
    const v = await verifyConnection(connection("resend"), {
      fetch: async () => Response.json(data, { status }),
    });
    assert.equal(v.status, expected);
    assert.equal(v.usable, false);
    assert(!JSON.stringify(v).includes("Run a controlled test send"));
  }
});
test("SendGrid documented scope-authorization denial is distinct from invalid credentials", async () => {
  const v = await verifyConnection(connection("sendgrid"), {
    fetch: async () =>
      Response.json(
        { errors: [{ message: "authorization required" }] },
        { status: 401 },
      ),
  });
  assert.equal(v.status, "MISSING_PERMISSION");
  assert.equal(v.usable, false);
});
