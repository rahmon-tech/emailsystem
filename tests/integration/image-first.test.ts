import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { preflight } from "@emailsystem/core/campaigns";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { redis } from "@emailsystem/core/redis";

let userId = "";
let providerId = "";
let importId = "";

before(async () => {
  userId = (
    await db.user.create({
      data: {
        email: `image-first-${crypto.randomUUID()}@example.com`,
        passwordHash: "test-only",
      },
    })
  ).id;
  const provider = await saveProvider(userId, {
    name: "Image capability probe",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
  });
  providerId = provider!.id;
  importId = (
    await importRecipients(
      userId,
      Buffer.from("email\nrecipient@example.net\n"),
      "image-first.csv",
    )
  ).id;
});

after(async () => {
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
  await redis.quit();
});

const image = Buffer.from("image-bytes").toString("base64");
const input = () => ({
  name: "Image-first integration",
  importId,
  from: "sender@example.com",
  subject: "Image-first",
  html: '<img src="cid:hero-image" alt="Hero" />',
  text: "Hero",
  tracking: { enabled: false },
  attachments: [
    {
      filename: "hero.png",
      content: image,
      contentType: "image/png",
      disposition: "inline" as const,
      contentId: "hero-image",
    },
  ],
});

test("preflight fails closed when the sender has no CID-capable transport", async () => {
  const result = await preflight(userId, input());
  assert.equal(result.ready, false);
  assert.equal(result.providers.length, 0);
  assert.match(result.problems.join(" "), /supports inline CID images/i);
});

test("preflight admits the same verified sender when its transport is CID-capable", async () => {
  await db.providerConnection.update({
    where: { id: providerId },
    data: { transport: "smtp" },
  });
  const result = await preflight(userId, input());
  assert.equal(result.ready, true);
  assert.deepEqual(result.providers.map((provider) => provider.id), [providerId]);
});
