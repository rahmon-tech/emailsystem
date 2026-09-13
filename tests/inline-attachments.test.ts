import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRequest,
  send,
} from "../packages/providers/src/index";
import type {
  Attachment,
  Dependencies,
  ProviderMessage,
} from "../packages/providers/src/index";
import { connection } from "./fixtures";

const ctx = {
  attemptId: "inline-attempt",
  idempotencyKey: "inline-idempotency",
};

const baseMessage: ProviderMessage = {
  from: "sender@example.com",
  fromName: "Sender",
  to: "recipient@example.net",
  cc: [],
  bcc: [],
  replyTo: "reply@example.com",
  subject: "Inline image",
  html: '<p>Hello <img src="cid:hero-image" /></p>',
  text: "Hello",
  headers: {},
  attachments: [],
};

const inlineAttachment: Attachment = {
  filename: "hero.png",
  content: Buffer.from("inline-image").toString("base64"),
  contentType: "image/png",
  disposition: "inline",
  contentId: "hero-image",
};

const regularAttachment: Attachment = {
  filename: "note.txt",
  content: Buffer.from("regular-attachment").toString("base64"),
  contentType: "text/plain",
};

function messageWith(attachments: Attachment[]): ProviderMessage {
  return { ...baseMessage, attachments };
}

function jsonBody(type: Parameters<typeof connection>[0], attachments: Attachment[]) {
  const request = buildRequest(connection(type), messageWith(attachments), ctx);
  return JSON.parse(String(request.body)) as Record<string, unknown>;
}

test("Resend preserves inline attachment Content-ID", () => {
  const body = jsonBody("resend", [inlineAttachment]);
  assert.deepEqual(body.attachments, [
    {
      filename: "hero.png",
      content: inlineAttachment.content,
      content_type: "image/png",
      content_id: "hero-image",
    },
  ]);
});

test("SendGrid preserves inline disposition and Content-ID", () => {
  const body = jsonBody("sendgrid", [inlineAttachment]);
  assert.deepEqual(body.attachments, [
    {
      content: inlineAttachment.content,
      filename: "hero.png",
      type: "image/png",
      disposition: "inline",
      content_id: "hero-image",
    },
  ]);
});

test("Postmark maps inline attachment ContentID using the cid prefix", () => {
  const body = jsonBody("postmark", [inlineAttachment]);
  assert.deepEqual(body.Attachments, [
    {
      Name: "hero.png",
      Content: inlineAttachment.content,
      ContentType: "image/png",
      ContentID: "cid:hero-image",
    },
  ]);
});

test("Mailjet separates inline attachments from ordinary attachments", () => {
  const body = jsonBody("mailjet", [regularAttachment, inlineAttachment]);
  const messages = body.Messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.Attachments, [
    {
      Filename: "note.txt",
      Base64Content: regularAttachment.content,
      ContentType: "text/plain",
    },
  ]);
  assert.deepEqual(messages[0]?.InlinedAttachments, [
    {
      Filename: "hero.png",
      Base64Content: inlineAttachment.content,
      ContentType: "image/png",
      ContentID: "hero-image",
    },
  ]);
});

test("Mailgun uses the inline multipart field and CID as the uploaded filename", () => {
  const request = buildRequest(
    connection("mailgun"),
    messageWith([inlineAttachment]),
    ctx,
  );
  assert(request.body instanceof FormData);
  const inline = request.body.get("inline");
  assert(inline instanceof Blob);
  assert.equal((inline as Blob & { name?: string }).name, "hero-image");
  assert.equal(request.body.get("attachment"), null);
});

test("API providers without explicit inline support fail closed", () => {
  assert.throws(
    () =>
      buildRequest(
        connection("brevo"),
        messageWith([inlineAttachment]),
        ctx,
      ),
    /Inline CID attachments are unavailable/,
  );
});

test("ordinary attachments remain supported on providers without inline CID support", () => {
  const body = jsonBody("brevo", [regularAttachment]);
  assert.deepEqual(body.attachment, [
    {
      name: "note.txt",
      content: regularAttachment.content,
    },
  ]);
});

test("duplicate inline Content-IDs are rejected", () => {
  assert.throws(
    () =>
      buildRequest(
        connection("resend"),
        messageWith([
          inlineAttachment,
          { ...inlineAttachment, filename: "second.png" },
        ]),
        ctx,
      ),
    /must be unique/,
  );
});

test("inline Content-IDs reject unsafe syntax, allow 127 characters, and reject 128", () => {
  assert.throws(
    () =>
      buildRequest(
        connection("resend"),
        messageWith([{ ...inlineAttachment, contentId: "unsafe id" }]),
        ctx,
      ),
    /safe Content-ID/,
  );

  const valid127 = `a${"b".repeat(126)}`;
  assert.doesNotThrow(() =>
    buildRequest(
      connection("resend"),
      messageWith([{ ...inlineAttachment, contentId: valid127 }]),
      ctx,
    ),
  );

  const invalid128 = `a${"b".repeat(127)}`;
  assert.throws(
    () =>
      buildRequest(
        connection("resend"),
        messageWith([{ ...inlineAttachment, contentId: invalid128 }]),
        ctx,
      ),
    /at most 127 characters/,
  );
});

test("SMTP preserves inline CID metadata for Nodemailer", async () => {
  const c = connection("smtp");
  let captured: Record<string, unknown> = {};
  const deps = {
    smtp: () => ({
      sendMail: async (options: Record<string, unknown>) => {
        captured = options;
        return { accepted: [baseMessage.to], messageId: "smtp-inline" };
      },
      close: () => {},
    }),
  } as unknown as Dependencies;

  const result = await send(c, messageWith([inlineAttachment]), ctx, deps);
  assert.deepEqual(result, {
    status: "accepted",
    providerMessageId: "smtp-inline",
  });
  const attachments = captured.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments[0]?.cid, "hero-image");
  assert.equal(attachments[0]?.contentDisposition, "inline");
  assert.equal(attachments[0]?.contentType, "image/png");
});

test("SES raw MIME preserves inline Content-ID and disposition", async () => {
  const c = connection("ses");
  let captured: unknown;
  const result = await send(c, messageWith([inlineAttachment]), ctx, {
    ses: {
      send: async (command) => {
        captured = command;
        return { MessageId: "ses-inline" };
      },
    },
  });
  assert.deepEqual(result, {
    status: "accepted",
    providerMessageId: "ses-inline",
  });
  const input = (
    captured as {
      input: { Content: { Raw: { Data: Uint8Array } } };
    }
  ).input;
  const mime = Buffer.from(input.Content.Raw.Data).toString("utf8");
  assert.match(mime, /Content-ID: <hero-image>/i);
  assert.match(mime, /Content-Disposition: inline/i);
  assert.match(mime, /Content-Type: image\/png/i);
});
