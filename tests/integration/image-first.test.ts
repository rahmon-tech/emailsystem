import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { preflight } from "@emailsystem/core/campaigns";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider, testProvider } from "@emailsystem/core/providers";
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
const brief = Buffer.from("ordinary-attachment").toString("base64");
const attachments = () => [
  {
    filename: "hero.png",
    content: image,
    contentType: "image/png",
    disposition: "inline" as const,
    contentId: "hero-image",
  },
  {
    filename: "brief.txt",
    content: brief,
    contentType: "text/plain",
    disposition: "attachment" as const,
  },
];
const input = () => ({
  name: "Image-first integration",
  importId,
  from: "sender@example.com",
  subject: "Image-first",
  html: '<img src="cid:hero-image" alt="Hero" />',
  text: "Hero",
  tracking: { enabled: false },
  attachments: attachments(),
});
const testMessage = () => ({
  from: "sender@example.com",
  fromName: "",
  to: "controlled@example.net",
  cc: [],
  bcc: [],
  replyTo: "",
  subject: "Image-first controlled test",
  html: '<img src="cid:hero-image" alt="Hero" />',
  text: "Hero",
  headers: {},
  attachments: attachments(),
});

test("preflight fails closed when a mixed inline/ordinary snapshot has no CID-capable transport", async () => {
  await db.providerConnection.update({
    where: { id: providerId },
    data: { transport: "api" },
  });
  const result = await preflight(userId, input());
  assert.equal(result.ready, false);
  assert.equal(result.providers.length, 0);
  assert.match(result.problems.join(" "), /supports inline CID images/i);
});

test("preflight admits the same mixed snapshot when its transport is CID-capable", async () => {
  await db.providerConnection.update({
    where: { id: providerId },
    data: { transport: "smtp" },
  });
  const result = await preflight(userId, input());
  assert.equal(result.ready, true);
  assert.deepEqual(result.providers.map((provider) => provider.id), [providerId]);
  assert.deepEqual(
    result.message.attachments.map((attachment) => [
      attachment.filename,
      attachment.disposition,
      attachment.contentId ?? null,
    ]),
    [
      ["hero.png", "inline", "hero-image"],
      ["brief.txt", "attachment", null],
    ],
  );
});

test("test message rejects an unsupported CID transport before creating a provider test delivery", async () => {
  await db.providerConnection.update({
    where: { id: providerId },
    data: { transport: "api" },
  });
  await db.providerTestDelivery.deleteMany({ where: { providerId } });

  await assert.rejects(
    () =>
      testProvider(
        userId,
        providerId,
        "controlled@example.net",
        false,
        testMessage(),
      ),
    /support inline CID images/i,
  );

  assert.equal(
    await db.providerTestDelivery.count({ where: { providerId } }),
    0,
  );
});

test("test message accepts the same CID snapshot through a capable mock transport", async () => {
  await db.providerConnection.update({
    where: { id: providerId },
    data: { transport: "smtp" },
  });
  await db.providerTestDelivery.deleteMany({ where: { providerId } });

  const result = await testProvider(
    userId,
    providerId,
    "controlled@example.net",
    false,
    testMessage(),
  );

  assert.equal(result?.status, "accepted");
  assert.equal(
    await db.providerTestDelivery.count({ where: { providerId } }),
    1,
  );
});