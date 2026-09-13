import { test } from "node:test";
import assert from "node:assert/strict";
import { messageInput } from "../packages/core/src/campaigns";
import { supportsInlineAttachmentTransport } from "../packages/providers/src/index";

const base = {
  name: "Image campaign",
  importId: "11111111-1111-4111-8111-111111111111",
  senderIdentityId: "22222222-2222-4222-8222-222222222222",
  subject: "Image-first",
  html: '<p><img src="cid:hero-image" alt="Hero" /></p>',
};

const content = Buffer.from("image-bytes").toString("base64");

function inline(contentId = "hero-image") {
  return {
    filename: "hero.png",
    content,
    contentType: "image/png",
    disposition: "inline" as const,
    contentId,
  };
}

test("campaign input preserves valid inline CID attachment metadata", () => {
  const parsed = messageInput.parse({ ...base, attachments: [inline()] });
  assert.deepEqual(parsed.attachments, [inline()]);
});

test("campaign input accepts the portable 127-character CID boundary", () => {
  const contentId = "a".repeat(127);
  const parsed = messageInput.parse({
    ...base,
    html: `<img src="cid:${contentId}" alt="Hero" />`,
    attachments: [inline(contentId)],
  });
  assert.equal(parsed.attachments[0]?.contentId, contentId);
});

test("campaign input rejects unsafe, overlong, missing and duplicate inline CIDs", () => {
  assert.throws(() =>
    messageInput.parse({ ...base, attachments: [inline("bad cid")] }),
  );
  assert.throws(() =>
    messageInput.parse({ ...base, attachments: [inline("a".repeat(128))] }),
  );
  const missing = inline() as ReturnType<typeof inline> & { contentId?: string };
  delete missing.contentId;
  assert.throws(() => messageInput.parse({ ...base, attachments: [missing] }));
  assert.throws(() =>
    messageInput.parse({
      ...base,
      attachments: [inline("same-cid"), { ...inline("same-cid"), filename: "second.png" }],
    }),
  );
});

test("ordinary attachments cannot smuggle a Content-ID", () => {
  assert.throws(() =>
    messageInput.parse({
      ...base,
      attachments: [
        {
          filename: "note.txt",
          content,
          contentType: "text/plain",
          disposition: "attachment",
          contentId: "unexpected-cid",
        },
      ],
    }),
  );
});

test("inline transport capability is explicit and fail-closed", () => {
  for (const type of ["resend", "sendgrid", "postmark", "mailjet", "mailgun"])
    assert.equal(supportsInlineAttachmentTransport({ type, transport: "api" }), true);
  assert.equal(supportsInlineAttachmentTransport({ type: "ses", transport: "api" }), true);
  assert.equal(supportsInlineAttachmentTransport({ type: "brevo", transport: "api" }), false);
  assert.equal(supportsInlineAttachmentTransport({ type: "smtp2go", transport: "api" }), false);
  assert.equal(supportsInlineAttachmentTransport({ type: "elastic", transport: "api" }), false);
  assert.equal(supportsInlineAttachmentTransport({ type: "smtp", transport: "smtp" }), true);
  assert.equal(supportsInlineAttachmentTransport({ type: "brevo", transport: "smtp" }), true);
});
