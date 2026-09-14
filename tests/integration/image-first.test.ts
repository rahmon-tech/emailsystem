import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import {
  createCampaign,
  preflight,
  prepareCampaign,
} from "@emailsystem/core/campaigns";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider, testProvider } from "@emailsystem/core/providers";
import { redis } from "@emailsystem/core/redis";
import { connection } from "../fixtures";

let userId = "";
let providerId = "";
let capableProviderId = "";
let importId = "";

const capableFrom = "cid-sender@cid.example.com";

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

  const { id: fixtureId, ...resend } = connection("resend");
  assert(fixtureId);
  const capable = await saveProvider(
    userId,
    {
      ...resend,
      name: "Image CID injected provider",
      perSecond: 10,
      perMinute: 60,
      settings: {
        ...resend.settings,
        fromEmail: capableFrom,
        domain: "cid.example.com",
      },
    },
    undefined,
    {
      fetch: async () =>
        Response.json({
          data: [{ name: "cid.example.com", status: "verified" }],
        }),
    },
  );
  capableProviderId = capable!.id;

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
const input = (from = "sender@example.com") => ({
  name: "Image-first integration",
  importId,
  from,
  subject: "Image-first",
  html: '<img src="cid:hero-image" alt="Hero" />',
  text: "Hero",
  tracking: { enabled: false },
  attachments: attachments(),
});
const testMessage = (from = "sender@example.com") => ({
  from,
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
  const result = await preflight(userId, input());
  assert.equal(result.ready, false);
  assert.equal(result.providers.length, 0);
  assert.match(result.problems.join(" "), /supports inline CID images/i);
});

test("preflight admits the same mixed snapshot when its transport is CID-capable", async () => {
  const result = await preflight(userId, input(capableFrom));
  assert.equal(result.ready, true);
  assert.deepEqual(result.providers.map((provider) => provider.id), [capableProviderId]);
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

test("image-first preflight preserves normalized CC and BCC through the existing campaign contract", async () => {
  const result = await preflight(userId, {
    ...input(capableFrom),
    cc: ["COPY@example.org", "copy-two@example.org"],
    bcc: ["BLIND@example.org"],
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.message.cc, ["copy@example.org", "copy-two@example.org"]);
  assert.deepEqual(result.message.bcc, ["blind@example.org"]);
  assert.match(result.warnings.join(" "), /3 CC\/BCC copies will be sent/i);
});

test("image-first preflight reuses duplicate CC BCC protection", async () => {
  const result = await preflight(userId, {
    ...input(capableFrom),
    cc: ["copy@example.org"],
    bcc: ["COPY@example.org"],
  });

  assert.equal(result.ready, false);
  assert.match(result.problems.join(" "), /CC and BCC addresses must be unique/i);
});

test("image-first scheduling reuses campaign and delivery timing owners", async () => {
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const campaign = await createCampaign(userId, {
    ...input(capableFrom),
    name: "Scheduled image-first integration",
    scheduledAt,
    startKey: crypto.randomUUID(),
  });

  assert.equal(campaign.scheduledAt.toISOString(), scheduledAt);
  await prepareCampaign(campaign.id);
  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id, userId },
  });
  assert.equal(delivery.nextAttemptAt.toISOString(), scheduledAt);
});

test("test message rejects an unsupported CID transport before creating a provider test delivery", async () => {
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

test("test message accepts the same CID snapshot through an injected capable provider without network access", async () => {
  await db.providerTestDelivery.deleteMany({ where: { providerId: capableProviderId } });
  let sends = 0;

  const result = await testProvider(
    userId,
    capableProviderId,
    "controlled@example.net",
    false,
    testMessage(capableFrom),
    {
      fetch: async (_url, init) => {
        sends++;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          attachments?: { filename?: string; content_id?: string }[];
        };
        assert.deepEqual(
          body.attachments?.map((attachment) => [
            attachment.filename,
            attachment.content_id ?? null,
          ]),
          [
            ["hero.png", "hero-image"],
            ["brief.txt", null],
          ],
        );
        return Response.json({ id: "injected-resend-message" });
      },
    },
  );

  assert.equal(sends, 1);
  assert.equal(result?.status, "accepted");
  assert.equal(result?.providerMessageId, "injected-resend-message");
  assert.equal(
    await db.providerTestDelivery.count({ where: { providerId: capableProviderId } }),
    1,
  );
});
