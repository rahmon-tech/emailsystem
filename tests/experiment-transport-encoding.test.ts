import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRequest,
  send,
  type Dependencies,
  type ProviderMessage,
} from "../packages/providers/src/index";
import { connection } from "./fixtures";

const baseMessage: ProviderMessage = {
  from: "sender@example.com",
  fromName: "Sender",
  to: "recipient@example.net",
  cc: [],
  bcc: [],
  replyTo: "",
  subject: "Explicit transfer encoding",
  html: "<p>Héllo encoding</p>",
  text: "Héllo encoding",
  headers: {},
  attachments: [],
};

const encodedMessage: ProviderMessage = {
  ...baseMessage,
  transportEncoding: "base64",
  charset: "utf-8",
};

test("SMTP maps explicit experiment transfer encoding into the native MIME owner", async () => {
  const c = { ...connection("smtp"), transport: "smtp" as const };
  let captured: Record<string, unknown> = {};
  const deps = {
    smtp: () => ({
      sendMail: async (options: Record<string, unknown>) => {
        captured = options;
        return { accepted: [encodedMessage.to], messageId: "smtp-encoded" };
      },
      close: () => {},
    }),
  } as unknown as Dependencies;

  assert.deepEqual(
    await send(
      c,
      encodedMessage,
      { attemptId: "encoding-smtp", idempotencyKey: "encoding-smtp" },
      deps,
    ),
    { status: "accepted", providerMessageId: "smtp-encoded" },
  );
  assert.equal(captured.encoding, "base64");
});

test("SES raw MIME applies the explicit transfer encoding and UTF-8 charset", async () => {
  const c = connection("ses");
  let captured: unknown;
  const result = await send(
    c,
    encodedMessage,
    { attemptId: "encoding-ses", idempotencyKey: "encoding-ses" },
    {
      ses: {
        send: async (command) => {
          captured = command;
          return { MessageId: "ses-encoded" };
        },
      },
    },
  );
  assert.deepEqual(result, {
    status: "accepted",
    providerMessageId: "ses-encoded",
  });
  const input = (
    captured as {
      input: { Content: { Raw: { Data: Uint8Array } } };
    }
  ).input;
  const mime = Buffer.from(input.Content.Raw.Data).toString();
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/i);
  assert.match(mime, /Content-Type: text\/html; charset=utf-8/i);
  assert.match(mime, /Content-Transfer-Encoding: base64/i);
});

test("API-body transports fail closed for an explicit raw MIME transfer encoding", () => {
  assert.throws(
    () =>
      buildRequest(
        connection("resend"),
        encodedMessage,
        { attemptId: "encoding-api", idempotencyKey: "encoding-api" },
      ),
    /transfer encoding|raw MIME/i,
  );
});
