import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "@emailsystem/core/templates";
import { AppError } from "@emailsystem/core/errors";

const users: string[] = [];

after(async () => {
  if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

async function user() {
  const row = await db.user.create({
    data: {
      email: crypto.randomUUID() + "@example.com",
      passwordHash: "test-only",
    },
  });
  users.push(row.id);
  return row;
}

test("starter templates are available without becoming mutable database rows", async () => {
  const owner = await user();
  const list = await listTemplates(owner.id);
  assert.equal(list.starters.length, 6);
  assert.equal(list.custom.length, 0);
  const starter = await getTemplate(owner.id, "starter-newsletter");
  assert.equal(starter.kind, "starter");
  assert.equal(starter.editorMode, "rich");
  assert.match(starter.previewHtml, /<!doctype html>/i);
  assert.match(starter.html, /Monthly update/);
  assert.equal(
    await db.emailTemplate.count({ where: { userId: owner.id } }),
    0,
  );
});

test("custom templates are owner-scoped, validated and editable", async () => {
  const owner = await user();
  const stranger = await user();
  const created = await createTemplate(owner.id, {
    name: "Quarterly update",
    category: "Newsletter",
    subject: "Quarterly news",
    preheader: "Highlights from the quarter",
    html: "<h1>Quarterly update</h1><p>Hello team.</p>",
    text: "",
    editorMode: "rich",
  });
  assert.equal(created.name, "Quarterly update");

  const fetched = await getTemplate(owner.id, created.id);
  assert.equal(fetched.kind, "custom");
  assert.equal(fetched.subject, "Quarterly news");
  assert.match(fetched.previewHtml, /Quarterly update/);

  await assert.rejects(
    () => getTemplate(stranger.id, created.id),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "NOT_FOUND",
  );

  const updated = await updateTemplate(owner.id, created.id, {
    name: "Quarterly report",
    editorMode: "source",
  });
  assert.equal(updated.name, "Quarterly report");
  assert.equal(updated.editorMode, "source");

  await assert.rejects(
    () =>
      createTemplate(owner.id, {
        name: "Too large",
        category: "Custom",
        subject: "",
        preheader: "",
        html: "<p>" + "x".repeat(513000) + "</p>",
        text: "",
        editorMode: "source",
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "TEMPLATE_HTML",
  );

  await deleteTemplate(owner.id, created.id);
  assert.equal(
    await db.emailTemplate.count({ where: { id: created.id } }),
    0,
  );
});
