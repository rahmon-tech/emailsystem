import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
  connectionSchema,
  endpoints,
  buildRequest,
  send,
  verifyConnection,
  normalizeError,
} from "../packages/providers/src/index";
import type {
  Connection,
  ProviderMessage,
} from "../packages/providers/src/index";
const message: ProviderMessage = {
  from: "sender@example.com",
  fromName: "Sender",
  to: "one@example.com",
  cc: ["copy@example.com"],
  bcc: ["blind@example.com"],
  replyTo: "reply@example.com",
  subject: "Hello",
  html: "<p>Body</p>",
  text: "Body",
  headers: { "List-Unsubscribe": "<https://example.com/unsubscribe/t>" },
  attachments: [],
};
import { connection } from "./fixtures";

for (const provider of catalog.filter((p) => p.api)) {
  test(`${provider.name}: schemas and built-in endpoints cannot be overridden`, () => {
    const c = connection(provider.id);
    assert(connectionSchema.safeParse(cWithoutId(c)).success);
    assert(endpoints(c).sendUrl?.startsWith("https://"));
    assert.equal(
      connectionSchema.safeParse({
        ...cWithoutId(c),
        settings: { ...c.settings, host: "localhost" },
      }).success,
      false,
    );
    assert.equal(
      connectionSchema.safeParse({ ...cWithoutId(c), credentials: {} }).success,
      false,
    );
  });
  test(`${provider.name}: send request maps isolated recipient, copies, reply and message content`, () => {
    const req = buildRequest(connection(provider.id), message, {
      attemptId: "attempt",
      idempotencyKey: "unique",
    });
    assert.equal(req.url, endpoints(connection(provider.id)).sendUrl);
    const body = String(req.body);
    for (const field of [
      "one@example.com",
      "copy@example.com",
      "blind@example.com",
      "reply@example.com",
      "Body",
    ])
      assert(body.includes(field) || decodeURIComponent(body).includes(field));
    assert(
      Object.keys(req.headers).some((k) => /authorization|key|token/i.test(k)),
    );
  });
  test(`${provider.name}: response failures have safe categories and never echo secrets`, async () => {
    const c = connection(provider.id);
    for (const [status, category] of [
      [401, "authentication"],
      [403, "authorization"],
      [429, "rate_limit"],
      [500, "temporary"],
      [400, "permanent"],
    ] as const) {
      const result = await send(
        c,
        message,
        { attemptId: "a", idempotencyKey: "i" },
        {
          fetch: async () =>
            new Response('{"message":"secret-key-value"}', { status }),
        },
      );
      assert.equal(result.status, "rejected");
      {
        assert.equal(result.error.category, category);
        assert(!result.error.message.includes("secret-key"));
      }
    }
    const timeout = await send(
      c,
      message,
      { attemptId: "a", idempotencyKey: "i" },
      {
        fetch: async () => {
          throw new Error("api-secret timeout");
        },
      },
    );
    assert.equal(timeout.status, "unknown");
  });
}
function cWithoutId(c: Connection) {
  const { id, ...rest } = c;
  void id;
  return rest;
}
test("read-scope denial is not invalid credentials and never silently enables sending", async () => {
  for (const t of ["mailgun", "brevo", "smtp2go", "elastic"] as const) {
    const result = await verifyConnection(connection(t), {
      fetch: async () => new Response("{}", { status: 403 }),
    });
    assert.equal(result.usable, false);
    assert.notEqual(result.status, "AUTH_ERROR");
  }
});
test("error normalization identifies policy enforcement", () => {
  assert.equal(
    normalizeError(403, "account suspended due to abuse").category,
    "policy",
  );
});

test("SMTP2GO selects documented regional API hosts", () => {
  for (const [region, host] of [
    ["US", "us-api.smtp2go.com"],
    ["EU", "eu-api.smtp2go.com"],
    ["AU", "au-api.smtp2go.com"],
  ]) {
    const c = connection("smtp2go");
    c.settings.region = region;
    assert.equal(new URL(endpoints(c).sendUrl!).hostname, host);
  }
});
