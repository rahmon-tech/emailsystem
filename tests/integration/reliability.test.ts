import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { saveProvider, unlocked } from "@emailsystem/core/providers";
import {
  createCampaign,
  prepareCampaign,
  controlCampaign,
  campaignSummary,
} from "@emailsystem/core/campaigns";
import {
  processDelivery,
  recoverStalled,
  finishCampaigns,
} from "@emailsystem/core/engine";
import { importRecipients } from "@emailsystem/core/imports";
import {
  ingestEvent,
  unsubscribe,
  reconcileEvents,
} from "@emailsystem/core/events";
import { acquireProvider, releaseProvider } from "@emailsystem/core/dispatcher";
import type { Candidate } from "@emailsystem/core/dispatcher";
import type { SendResult } from "@emailsystem/providers";
const users: string[] = [];
async function fixture(mode = "success", count = 1) {
  const user = await db.user.create({
    data: {
      email: crypto.randomUUID() + "@example.com",
      passwordHash: "isolated-test",
    },
  });
  users.push(user.id);
  const provider = await saveProvider(user.id, {
    name: "Test adapter",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com", mockMode: mode },
    perSecond: 100,
    perMinute: 1000,
    concurrency: 20,
  });
  assert(provider);
  const list = await importRecipients(
    user.id,
    Buffer.from(
      Array.from({ length: count }, (_, i) => `recipient${i}@example.net`).join(
        "\n",
      ),
    ),
    "list.txt",
  );
  const campaign = await createCampaign(user.id, {
    name: "Reliability",
    from: "sender@example.com",
    subject: "Test",
    html: "<p>Message</p>",
    importId: list.id,
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { id: "asc" },
  });
  return { user, provider, list, campaign, deliveries };
}
before(() => {
  assert.equal(
    process.env.ALLOW_MOCK_PROVIDER,
    "true",
    "Integration tests require an explicitly enabled mock provider",
  );
});
after(async () => {
  await db.providerEvent.deleteMany({
    where: { provider: { userId: { in: users } } },
  });
  await db.deliveryAttempt.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});
test("two claims and cancel during an in-flight request preserve one accepted attempt", async () => {
  const f = await fixture("success", 2);
  let mark!: () => void;
  const started = new Promise<void>((r) => (mark = r));
  let finish!: (v: SendResult) => void;
  const gate = new Promise<SendResult>((r) => (finish = r));
  let sends = 0;
  const first = processDelivery(f.deliveries[0].id, async () => {
    sends++;
    mark();
    return gate;
  });
  await started;
  await Promise.all([
    processDelivery(f.deliveries[0].id),
    controlCampaign(f.user.id, f.campaign.id, "cancel"),
  ]);
  finish({ status: "accepted", providerMessageId: "in-flight" });
  await first;
  await finishCampaigns();
  assert.equal(sends, 1);
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: f.deliveries[0].id } }))
      .state,
    "PROVIDER_ACCEPTED",
  );
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: f.deliveries[1].id } }))
      .state,
    "CANCELLED",
  );
  assert.equal(
    (await campaignSummary(f.user.id, f.campaign.id)).acceptedCount,
    1,
  );
});
test("authenticated delivery arriving before a lost response wins; duplicate webhook is idempotent", async () => {
  const f = await fixture();
  const id = f.deliveries[0].id;
  let event!: Parameters<typeof ingestEvent>[1];
  await processDelivery(id, async (_c, _m, ctx) => {
    event = {
      eventKey: "delivery-event",
      messageId: "early-provider-id",
      attemptId: ctx.attemptId,
      recipient: f.deliveries[0].email,
      kind: "delivered",
      occurredAt: new Date(),
    };
    await ingestEvent(f.provider.id, event);
    return {
      status: "unknown",
      error: { category: "unknown", message: "Lost response" },
    };
  });
  await Promise.all([
    ingestEvent(f.provider.id, event),
    ingestEvent(f.provider.id, event),
    processDelivery(id),
  ]);
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id } })).state,
    "DELIVERED",
  );
  assert.equal(
    await db.deliveryAttempt.count({
      where: { deliveryId: id, state: "ACCEPTED" },
    }),
    1,
  );
  assert.equal(
    await db.activityEvent.count({
      where: { deliveryId: id, kind: "DELIVERED" },
    }),
    1,
  );
});
test("temporary rejection retries once eligible; unknown outcome never retries", async () => {
  const f = await fixture("temporary");
  const id = f.deliveries[0].id;
  await processDelivery(id);
  let d = await db.delivery.findUniqueOrThrow({ where: { id } });
  assert.equal(d.state, "DEFERRED");
  assert(d.nextAttemptAt > new Date());
  await processDelivery(id);
  assert.equal(
    await db.deliveryAttempt.count({ where: { deliveryId: id } }),
    1,
  );
  await db.providerConnection.update({
    where: { id: f.provider.id },
    data: {
      cooldownUntil: null,
      settings: {
        ...unlocked(
          await db.providerConnection.findUniqueOrThrow({
            where: { id: f.provider.id },
          }),
        ).settings,
        mockMode: "success",
      },
    },
  });
  await db.delivery.update({
    where: { id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processDelivery(id);
  d = await db.delivery.findUniqueOrThrow({ where: { id } });
  assert.equal(d.state, "PROVIDER_ACCEPTED");
  assert.equal(d.attemptCount, 2);
  const u = await fixture("unknown");
  await processDelivery(u.deliveries[0].id);
  await processDelivery(u.deliveries[0].id);
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: u.deliveries[0].id } }))
      .state,
    "UNKNOWN",
  );
  assert.equal(
    await db.deliveryAttempt.count({
      where: { deliveryId: u.deliveries[0].id },
    }),
    1,
  );
});
test("stalled processing becomes unknown and is never automatically resent", async () => {
  const f = await fixture();
  const d = f.deliveries[0],
    attemptId = crypto.randomUUID();
  await db.delivery.update({
    where: { id: d.id },
    data: {
      state: "PROCESSING",
      claimId: attemptId,
      claimedAt: new Date(Date.now() - 240000),
      attemptCount: 1,
    },
  });
  await db.deliveryAttempt.create({
    data: {
      id: attemptId,
      deliveryId: d.id,
      userId: f.user.id,
      providerId: f.provider.id,
      providerRevision: 1,
      idempotencyKey: attemptId,
    },
  });
  await recoverStalled();
  await processDelivery(d.id);
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: d.id } })).state,
    "UNKNOWN",
  );
  assert.equal(
    await db.deliveryAttempt.count({ where: { deliveryId: d.id } }),
    1,
  );
});
test("hard bounce and signed unsubscribe suppress future deliveries and imported rows", async () => {
  const f = await fixture();
  const d = f.deliveries[0];
  await processDelivery(d.id);
  const attempt = await db.deliveryAttempt.findFirstOrThrow({
    where: { deliveryId: d.id },
  });
  await ingestEvent(f.provider.id, {
    eventKey: "hard",
    messageId: attempt.providerMessageId!,
    recipient: d.email,
    kind: "hard_bounce",
    occurredAt: new Date(),
  });
  const list = await importRecipients(
    f.user.id,
    Buffer.from(d.email + "\nnew@example.com"),
    "next.txt",
  );
  assert.equal((list.stats as { suppressed: number }).suppressed, 1);
  await unsubscribe(d.unsubscribeToken);
  await assert.rejects(() => unsubscribe(d.unsubscribeToken + "forged"));
  assert.equal(
    await db.suppression.count({
      where: { userId: f.user.id, email: d.email },
    }),
    1,
  );
});
test("XLSX import detects the email column and deduplicates normalized addresses", async () => {
  const f = await fixture();
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Contacts");
  sheet.addRows([
    ["Name", "Email"],
    ["A", "USER@example.com"],
    ["A again", "user@example.com"],
    ["B", "bad"],
    ["C", "good@example.net"],
  ]);
  const list = await importRecipients(
    f.user.id,
    Buffer.from(await book.xlsx.writeBuffer()),
    "contacts.xlsx",
  );
  assert.equal((list.stats as { sendable: number }).sendable, 2);
  assert.equal((list.stats as { duplicate: number }).duplicate, 1);
});
test("unmatched events do not starve later matching events", async () => {
  const f = await fixture();
  await processDelivery(f.deliveries[0].id);
  const attempt = await db.deliveryAttempt.findFirstOrThrow({
    where: { deliveryId: f.deliveries[0].id },
  });
  await db.providerEvent.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({
      providerId: f.provider.id,
      eventKey: "unmatched-" + i,
      messageId: "none-" + i,
      kind: "delivered",
      occurredAt: new Date(),
    })),
  });
  await db.providerEvent.create({
    data: {
      providerId: f.provider.id,
      eventKey: "matched",
      messageId: attempt.providerMessageId!,
      kind: "delivered",
      occurredAt: new Date(),
    },
  });
  await reconcileEvents();
  await reconcileEvents();
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: f.deliveries[0].id } }))
      .state,
    "DELIVERED",
  );
});
test("Redis coordinates weighted fairness, shared limits and concurrency across callers", async () => {
  const user = "rate-test-" + crypto.randomUUID();
  const a: Candidate = {
      id: "a",
      group: "a",
      cost: 1,
      weight: 3,
      perSecond: 1000,
      perMinute: 1000,
      concurrency: 1,
    },
    b = { ...a, id: "b", group: "b", weight: 1 };
  let aCount = 0;
  for (let i = 0; i < 80; i++) {
    const token = crypto.randomUUID();
    const id = await acquireProvider(user, [a, b], token);
    assert(id);
    if (id === "a") aCount++;
    await releaseProvider(user, id === "a" ? a : b, token);
  }
  assert.equal(aCount, 60);
  const shared = [
    { ...a, group: "shared", perSecond: 1, concurrency: 2 },
    { ...b, group: "shared", perSecond: 1, concurrency: 2 },
  ];
  const choices = await Promise.all(
    Array.from({ length: 8 }, () =>
      acquireProvider("shared-" + user, shared, crypto.randomUUID()),
    ),
  );
  assert.equal(choices.filter(Boolean).length, 1);
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () =>
      acquireProvider("concurrency-" + user, [a], crypto.randomUUID()),
    ),
  );
  assert.equal(concurrent.filter(Boolean).length, 1);
});
