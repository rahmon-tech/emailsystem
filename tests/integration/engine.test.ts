import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import {
  createCampaign,
  prepareCampaign,
  controlCampaign,
} from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
let userId: string;
let otherId: string;
let campaignId: string;
before(async () => {
  const u = await db.user.create({
    data: {
      email: `test-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-only",
    },
  });
  userId = u.id;
  otherId = (
    await db.user.create({
      data: {
        email: `test-${crypto.randomUUID()}@example.com`,
        passwordHash: "test-only",
      },
    })
  ).id;
});
after(async () => {
  if (userId)
    await db.deliveryAttempt.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
  if (userId)
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
  await redis.quit();
});
test("durable import/start is idempotent, tenant scoped and two workers claim once", async () => {
  const input = {
    name: "Mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
  };
  await saveProvider(userId, input);
  const list = await importRecipients(
    userId,
    Buffer.from(
      "email\none@example.com\none@example.com\ntwo@example.com\nbad\n",
    ),
    "list.csv",
  );
  assert.equal((list.stats as { duplicate: number }).duplicate, 1);
  const data = {
    name: "Campaign",
    importId: list.id,
    from: "sender@example.com",
    fromName: "Sender",
    subject: "Hi",
    html: "<p>Hello</p>",
    startKey: crypto.randomUUID(),
  };
  const [a, b] = await Promise.all([
    createCampaign(userId, data),
    createCampaign(userId, data),
  ]);
  assert.equal(a.id, b.id);
  campaignId = a.id;
  await assert.rejects(() => controlCampaign(otherId, campaignId, "cancel"));
  await assert.rejects(() =>
    createCampaign(otherId, { ...data, startKey: crypto.randomUUID() }),
  );
  await prepareCampaign(campaignId);
  await prepareCampaign(campaignId);
  assert.equal(await db.delivery.count({ where: { campaignId } }), 2);
  const d = await db.delivery.findFirstOrThrow({ where: { campaignId } });
  await Promise.all([processDelivery(d.id), processDelivery(d.id)]);
  assert.equal(
    await db.deliveryAttempt.count({ where: { deliveryId: d.id } }),
    1,
  );
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: d.id } })).state,
    "PROVIDER_ACCEPTED",
  );
});
test("pause/resume/cancel only affect eligible unclaimed deliveries", async () => {
  await controlCampaign(userId, campaignId, "pause");
  const d = await db.delivery.findFirstOrThrow({
    where: { campaignId, state: { in: ["PENDING", "QUEUED"] } },
  });
  await processDelivery(d.id);
  assert.equal(
    await db.deliveryAttempt.count({ where: { deliveryId: d.id } }),
    0,
  );
  await controlCampaign(userId, campaignId, "resume");
  await controlCampaign(userId, campaignId, "cancel");
  await processDelivery(d.id);
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: d.id } })).state,
    "CANCELLED",
  );
  assert.equal(
    await db.delivery.count({
      where: { campaignId, state: "PROVIDER_ACCEPTED" },
    }),
    1,
  );
});
