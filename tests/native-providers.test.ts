import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
  connectionSchema,
  endpoints,
  send,
  verifyConnection,
  normalizeError,
  buildSmtpOptions,
} from "../packages/providers/src/index";
import type {
  Dependencies,
  ProviderMessage,
} from "../packages/providers/src/index";
import { connection } from "./fixtures";
const message: ProviderMessage = {
  from: "sender@example.com",
  fromName: "Sender",
  to: "recipient@example.net",
  cc: ["copy@example.net"],
  bcc: ["audit@example.net"],
  replyTo: "reply@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  headers: { "List-Unsubscribe": "<https://example.com/unsubscribe>" },
  attachments: [
    {
      filename: "note.txt",
      content: Buffer.from("note").toString("base64"),
      contentType: "text/plain",
    },
  ],
};
for (const def of catalog.filter((d) => d.smtp || d.id === "smtp")) {
  const c = { ...connection(def.id), transport: "smtp" as const };
  test(`${def.name} SMTP: preset, encrypted transport, credentials and message mapping`, async () => {
    assert(connectionSchema.safeParse(cWithoutId(c)).success);
    const ep = endpoints(c);
    assert(ep.smtpHost);
    const options = buildSmtpOptions(c, "203.0.113.10");
    assert.equal(options.host, "203.0.113.10");
    assert.equal(options.tls?.servername, ep.smtpHost);
    assert.equal(options.tls?.rejectUnauthorized, true);
    assert(options.secure || options.requireTLS);
    assert(options.auth?.user);
    assert(options.auth?.pass);
    let captured: Record<string, unknown> = {};
    let closed = 0;
    const deps = {
      smtp: () => ({
        verify: async () => true,
        sendMail: async (o: Record<string, unknown>) => {
          captured = o;
          return { accepted: [message.to], messageId: "smtp-accepted" };
        },
        close: () => closed++,
      }),
    } as unknown as Dependencies;
    assert.equal((await verifyConnection(c, deps)).usable, true);
    assert.deepEqual(
      await send(
        c,
        message,
        { attemptId: "attempt", idempotencyKey: "key" },
        deps,
      ),
      { status: "accepted", providerMessageId: "smtp-accepted" },
    );
    assert.equal(captured.to, message.to);
    assert.deepEqual(captured.cc, message.cc);
    assert.deepEqual(captured.bcc, message.bcc);
    assert.equal(captured.replyTo, message.replyTo);
    assert.equal(captured.html, message.html);
    assert.equal(captured.text, message.text);
    assert.equal(closed, 2);
  });
  test(`${def.name} SMTP: transient, permanent, throttle, authentication and safe errors`, async () => {
    for (const [responseCode, category] of [
      [451, "temporary"],
      [550, "permanent"],
      [421, "rate_limit"],
      [535, "authentication"],
    ] as const) {
      const deps = {
        smtp: () => ({
          sendMail: async () => {
            throw { responseCode, message: "secret-value" };
          },
          verify: async () => {
            throw { responseCode, message: "secret-value" };
          },
          close: () => {},
        }),
      } as unknown as Dependencies;
      const result = await send(
        c,
        message,
        { attemptId: "a", idempotencyKey: "i" },
        deps,
      );
      assert.equal(result.status, "rejected");
      assert.equal(result.error.category, category);
      assert(!result.error.message.includes("secret-value"));
      if (responseCode === 535)
        assert.equal((await verifyConnection(c, deps)).status, "AUTH_ERROR");
    }
  });
}
function cWithoutId(c: ReturnType<typeof connection>) {
  const { id, ...rest } = c;
  assert(id);
  return rest;
}
test("SES SDK constructs raw MIME and maps acceptance without implicit SDK retries", async () => {
  const c = connection("ses");
  let captured: unknown;
  const sent = await send(
    c,
    message,
    { attemptId: "a", idempotencyKey: "i" },
    {
      ses: {
        send: async (command) => {
          captured = command;
          return { MessageId: "ses-id" };
        },
      },
    },
  );
  assert.deepEqual(sent, { status: "accepted", providerMessageId: "ses-id" });
  const input = (
    captured as {
      input: {
        Content: { Raw: { Data: Uint8Array } };
        Destination: { ToAddresses: string[] };
      };
    }
  ).input;
  assert.deepEqual(input.Destination.ToAddresses, [message.to]);
  const mime = Buffer.from(input.Content.Raw.Data).toString();
  assert.match(mime, /Reply-To: reply@example.com/);
  assert.match(mime, /Content-Type: multipart\/mixed/);
  assert.match(mime, /List-Unsubscribe:/);
});
test("SES verification distinguishes sandbox, sender, auth and sending enforcement", async () => {
  const c = connection("ses");
  for (const production of [true, false]) {
    const v = await verifyConnection(c, {
      ses: {
        send: async (command) =>
          (command as object).constructor.name === "GetAccountCommand"
            ? {
                SendingEnabled: true,
                ProductionAccessEnabled: production,
                SendQuota: { MaxSendRate: 14 },
              }
            : { VerifiedForSendingStatus: true },
      },
    });
    assert.equal(v.status, production ? "HEALTHY" : "SANDBOX");
    assert.equal(v.maxSendRate, 14);
    assert.equal(v.usable, production);
  }
  assert.equal(
    (
      await verifyConnection(c, {
        ses: { send: async () => ({ SendingEnabled: false }) },
      })
    ).status,
    "POLICY_BLOCKED",
  );
  assert.equal(
    (
      await verifyConnection(c, {
        ses: {
          send: async () => {
            throw { $metadata: { httpStatusCode: 401 } };
          },
        },
      })
    ).status,
    "AUTH_ERROR",
  );
});
test("HTTP validation errors never use SMTP temporary classification", () => {
  assert.equal(normalizeError(422).category, "permanent");
  assert.equal(
    normalizeError(451, "", undefined, "smtp").category,
    "temporary",
  );
});
test("SMTP exceeding the overall deadline is unknown and is closed before the worker lease expires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let closed = 0;
  const pending = send(
    { ...connection("smtp"), transport: "smtp" },
    message,
    { attemptId: "deadline", idempotencyKey: "deadline" },
    {
      smtp: () => ({
        sendMail: () => new Promise(() => {}),
        close: () => closed++,
      }),
    } as unknown as Dependencies,
  );
  t.mock.timers.tick(90000);
  const result = await pending;
  assert.equal(result.status, "unknown");
  assert.equal(result.error?.category, "unknown");
  assert.equal(closed, 1);
});
