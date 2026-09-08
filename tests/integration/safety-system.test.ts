import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import {
  createCampaign,
  prepareCampaign,
  preflight,
  campaignSummary,
  controlCampaign,
} from "@emailsystem/core/campaigns";
import {
  processDelivery,
  finishCampaigns,
  recoverStalled,
} from "@emailsystem/core/engine";
import { saveProvider, testProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import {
  getSafetySettings,
  saveSafetySettings,
  rebuildSafety,
  safetyCapacity,
  lockSafety,
} from "@emailsystem/core/safety";
import { reviewSafety, safetyOutcomes } from "@emailsystem/core/safety-brakes";
import { ingestEvent } from "@emailsystem/core/events";
const users: string[] = [];
async function fixture(count = 1, settings = {}, copies = false) {
  const user = await db.user.create({
    data: {
      email: crypto.randomUUID() + "@example.com",
      passwordHash: "test-only",
      safetySettings: settings,
    },
  });
  users.push(user.id);
  const provider = await saveProvider(user.id, {
    name: "Safety test",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 100,
    perMinute: 6000,
    concurrency: 20,
  });
  assert(provider);
  const list = await importRecipients(
    user.id,
    Buffer.from(
      Array.from({ length: count }, (_, i) => `person${i}@example.net`).join(
        "\n",
      ),
    ),
    "list.txt",
  );
  const input = {
    name: "Safety",
    importId: list.id,
    from: "sender@example.com",
    subject: "Test",
    html: "<p>Test</p>",
    ...(copies
      ? { cc: ["audit@example.com"], bcc: ["archive@example.com"] }
      : {}),
  };
  const campaign = await createCampaign(user.id, input);
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { id: "asc" },
  });
  return { user, provider, campaign, deliveries, input };
}
after(async () => {
  await db.providerEvent.deleteMany({
    where: { provider: { userId: { in: users } } },
  });
  await db.deliveryAttempt.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users) await redis.del(`safety:{${id}}`);
  await db.$disconnect();
  await redis.quit();
});
test("150-recipient campaign queues across days: exactly 100 claims, durable waiting reason, then remaining 50", async () => {
  const f = await fixture(150, {
    accountDaily: 100,
    domainDaily: 1000,
    providerDaily: 100,
    campaignDaily: 1000,
  });
  await saveProvider(f.user.id, {
    name: "Second provider",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 100,
    perMinute: 6000,
    concurrency: 20,
  });
  const flight = await preflight(f.user.id, f.input);
  assert(flight.ready);
  assert.equal(flight.safety.campaignUnits, 150);
  assert.equal(flight.safety.availableUnits, 100);
  let clock = Date.now(),
    sends = 0;
  const send = async () => {
    sends++;
    return {
      status: "accepted" as const,
      providerMessageId: crypto.randomUUID(),
    };
  };
  for (const d of f.deliveries) await processDelivery(d.id, send, () => clock);
  assert.equal(sends, 100);
  const summary = await campaignSummary(f.user.id, f.campaign.id);
  assert.equal(summary.state, "SENDING");
  assert.equal(summary.acceptedCount, 100);
  assert.match(summary.safety.waitReason!, /Daily safety limit/);
  assert.equal(
    await db.delivery.count({
      where: { campaignId: f.campaign.id, state: "FAILED" },
    }),
    0,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { userId: f.user.id, action: "safety.account_limit_reached" },
    }),
    1,
  );
  clock += 86460000;
  const pending = await db.delivery.findMany({
    where: {
      campaignId: f.campaign.id,
      state: { in: ["PENDING", "QUEUED", "DEFERRED"] },
    },
  });
  assert.equal(pending.length, 50);
  // Provider fixed rate windows use real Redis time; clear only this fixture's
  // short-window permits to model their expiry alongside the injected day clock.
  const rateKeys = await redis.keys(`dispatch:${f.user.id}:*`);
  if (rateKeys.length) await redis.del(...rateKeys);
  for (const d of pending) await processDelivery(d.id, send, () => clock);
  assert.equal(sends, 150);
  await finishCampaigns();
  assert.equal(
    (await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }))
      .state,
    "COMPLETED",
  );
});
test("Redis flush rebuild retains transmitted UNKNOWN and accepted costs including CC/BCC", async () => {
  const f = await fixture(2, {}, true);
  await processDelivery(f.deliveries[0].id, async () => ({
    status: "unknown",
    error: { category: "unknown", message: "Uncertain" },
  }));
  await processDelivery(f.deliveries[1].id, async () => ({
    status: "accepted",
    providerMessageId: "accepted",
  }));
  await redis.flushdb();
  await rebuildSafety(f.user.id);
  const usage = (await safetyCapacity(f.user.id, f.input.from, f.campaign.id))
    .usage;
  assert(usage.every((b) => b.used === 6));
  assert.equal(
    await db.deliveryAttempt.count({
      where: {
        userId: f.user.id,
        state: "UNKNOWN",
        messageUnits: 3,
        transmissionStartedAt: { not: null },
      },
    }),
    1,
  );
  await processDelivery(f.deliveries[0].id, async () => {
    throw new Error("must not resend unknown");
  });
});
test("decryption failure before transport releases all reservations and leaves a retryable delivery", async () => {
  const f = await fixture();
  await db.providerConnection.update({
    where: { id: f.provider.id },
    data: { credentials: {} },
  });
  await assert.rejects(() => processDelivery(f.deliveries[0].id));
  const a = await db.deliveryAttempt.findFirstOrThrow({
    where: { userId: f.user.id },
  });
  assert.equal(a.state, "NOT_STARTED");
  assert.equal(a.transmissionStartedAt, null);
  assert.equal(
    (
      await db.providerConnection.findUniqueOrThrow({
        where: { id: f.provider.id },
      })
    ).enabled,
    false,
  );
  assert(
    (await safetyCapacity(f.user.id, f.input.from, f.campaign.id)).usage.every(
      (b) => b.used === 0,
    ),
  );
  assert.equal(
    (await db.delivery.findUniqueOrThrow({ where: { id: f.deliveries[0].id } }))
      .state,
    "DEFERRED",
  );
});
test("recovery releases durable unstarted reservations but preserves interrupted transmitted attempts", async () => {
  const f = await fixture(2),
    old = new Date(Date.now() - 240000);
  for (const [i, d] of f.deliveries.entries()) {
    const id = crypto.randomUUID();
    await db.deliveryAttempt.create({
      data: {
        id,
        userId: f.user.id,
        deliveryId: d.id,
        providerId: f.provider.id,
        providerRevision: 1,
        idempotencyKey: id,
        state: i === 0 ? "RESERVED" : "PROCESSING",
        startedAt: old,
        safetyReservedAt: old,
        transmissionStartedAt: i === 0 ? null : old,
        messageUnits: 1,
        senderDomain: "example.com",
      },
    });
    await db.delivery.update({
      where: { id: d.id },
      data: {
        state: "PROCESSING",
        claimId: id,
        claimedAt: old,
        attemptCount: 1,
      },
    });
  }
  await db.providerConnection.update({
    where: { id: f.provider.id },
    data: { quotaRemaining: 0, quotaCheckedAt: new Date() },
  });
  await recoverStalled();
  assert.equal(
    (
      await db.providerConnection.findUniqueOrThrow({
        where: { id: f.provider.id },
      })
    ).quotaRemaining,
    0,
    "An unstarted refund cannot increase a freshly reported provider quota",
  );
  await rebuildSafety(f.user.id);
  const states = await db.delivery.findMany({
    where: { campaignId: f.campaign.id },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(
    states.map((d) => d.state),
    ["DEFERRED", "UNKNOWN"],
  );
  assert(
    (await safetyCapacity(f.user.id, f.input.from, f.campaign.id)).usage.every(
      (b) => b.used === 1,
    ),
  );
});
test("safety settings and reviews enforce ownership, validation, explicit unlimited and sticky pauses", async () => {
  const a = await fixture(),
    b = await fixture();
  await assert.rejects(() =>
    saveSafetySettings(a.user.id, {
      providers: [{ id: b.provider.id, dailyBudgetOverride: 10 }],
    }),
  );
  await assert.rejects(() =>
    saveSafetySettings(a.user.id, { accountDaily: 0 }),
  );
  await assert.rejects(() =>
    reviewSafety(a.user.id, {
      campaignId: b.campaign.id,
      acknowledgement: true,
    }),
  );
  await assert.rejects(() =>
    reviewSafety(a.user.id, { acknowledgement: false }),
  );
  await saveSafetySettings(a.user.id, { campaignDaily: null });
  assert.equal((await getSafetySettings(a.user.id)).campaignDaily, null);
  await db.campaign.update({
    where: { id: a.campaign.id },
    data: { state: "PAUSED", safetyPausedReason: "complaint review" },
  });
  await assert.rejects(() =>
    controlCampaign(a.user.id, a.campaign.id, "resume"),
  );
  await saveSafetySettings(a.user.id, { complaintRate: 1 });
  await assert.rejects(() =>
    controlCampaign(a.user.id, a.campaign.id, "resume"),
  );
  await reviewSafety(a.user.id, {
    campaignId: a.campaign.id,
    acknowledgement: true,
  });
  assert.equal(
    (await db.campaign.findUniqueOrThrow({ where: { id: a.campaign.id } }))
      .state,
    "PAUSED",
  );
  await controlCampaign(a.user.id, a.campaign.id, "resume");
  await db.providerConnection.update({
    where: { id: a.provider.id },
    data: { health: "POLICY_BLOCKED" },
  });
  await controlCampaign(a.user.id, a.campaign.id, "pause");
  await assert.rejects(() =>
    reviewSafety(a.user.id, { acknowledgement: true }),
  );
  await assert.rejects(() =>
    controlCampaign(a.user.id, a.campaign.id, "resume"),
  );
});
async function acceptedFixture(count: number, settings = {}) {
  const f = await fixture(count, settings);
  const at = new Date(Date.now() - 60000);
  await db.deliveryAttempt.createMany({
    data: f.deliveries.map((d) => ({
      id: crypto.randomUUID(),
      userId: f.user.id,
      deliveryId: d.id,
      providerId: f.provider.id,
      providerRevision: 1,
      idempotencyKey: crypto.randomUUID(),
      providerMessageId: d.id,
      state: "ACCEPTED",
      startedAt: at,
      safetyReservedAt: at,
      transmissionStartedAt: at,
      senderDomain: "example.com",
    })),
  });
  await db.delivery.updateMany({
    where: { campaignId: f.campaign.id },
    data: { state: "PROVIDER_ACCEPTED", acceptedAt: at },
  });
  return f;
}
test("authoritative complaints require the minimum sample, deduplicate outcomes and exclude previously suppressed recipients", async () => {
  const f = await acceptedFixture(101);
  await db.suppression.create({
    data: {
      userId: f.user.id,
      email: f.deliveries[100].email,
      reason: "manual",
      createdAt: new Date(Date.now() - 120000),
    },
  });
  const event = {
    eventKey: "complaint",
    messageId: f.deliveries[0].id,
    recipient: f.deliveries[0].email,
    kind: "complaint" as const,
    occurredAt: new Date(),
  };
  await ingestEvent(f.provider.id, event);
  await ingestEvent(f.provider.id, event);
  await ingestEvent(f.provider.id, {
    ...event,
    eventKey: "duplicate-payload-new-id",
  });
  const outcomes = await db.$transaction(async (tx) => {
    await lockSafety(tx, f.user.id);
    return safetyOutcomes(tx, f.user.id, null, new Date(Date.now() - 86400000));
  });
  assert.deepEqual(outcomes, { sample: 100, complaints: 1, hardBounces: 0 });
  assert.match((await getSafetySettings(f.user.id)).pausedReason!, /Complaint/);
  assert.equal(
    (await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }))
      .state,
    "PAUSED",
  );
  assert.equal(
    await db.auditEvent.count({
      where: { userId: f.user.id, action: "safety.auto_paused" },
    }),
    1,
  );
  const small = await acceptedFixture(99);
  await ingestEvent(small.provider.id, {
    ...event,
    messageId: small.deliveries[0].id,
    recipient: small.deliveries[0].email,
  });
  assert.equal((await getSafetySettings(small.user.id)).pausedReason, null);
});
test("campaign hard-bounce brake pauses only the affected campaign and requires review", async () => {
  const f = await acceptedFixture(100, { brakeScope: "campaign" });
  const other = await createCampaign(f.user.id, {
    ...f.input,
    name: "Unaffected",
  });
  await prepareCampaign(other.id);
  for (const d of f.deliveries.slice(0, 2))
    await ingestEvent(f.provider.id, {
      eventKey: "bounce-" + d.id,
      messageId: d.id,
      recipient: d.email,
      kind: "hard_bounce",
      occurredAt: new Date(),
    });
  assert.equal((await getSafetySettings(f.user.id)).pausedReason, null);
  assert.equal(
    (await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }))
      .state,
    "PAUSED",
  );
  assert.equal(
    (await db.campaign.findUniqueOrThrow({ where: { id: other.id } })).state,
    "QUEUED",
  );
  await assert.rejects(() =>
    controlCampaign(f.user.id, f.campaign.id, "resume"),
  );
});
test("no healthy providers stop claims with a durable explanation, without failure or audit flooding", async () => {
  const f = await fixture(2);
  await db.providerConnection.update({
    where: { id: f.provider.id },
    data: { enabled: false },
  });
  for (const d of f.deliveries) await processDelivery(d.id);
  assert.equal(
    await db.deliveryAttempt.count({ where: { userId: f.user.id } }),
    0,
  );
  assert.match(
    (await campaignSummary(f.user.id, f.campaign.id)).safety.waitReason!,
    /No healthy eligible provider/,
  );
  assert.equal(
    await db.activityEvent.count({
      where: { campaignId: f.campaign.id, kind: "SAFETY_WAIT" },
    }),
    1,
  );
});

test("controlled test sends consume safety capacity without entering campaign statistics", async () => {
  const f = await fixture(1, { accountDaily: 1 });
  await testProvider(f.user.id, f.provider.id, "controlled@example.net");
  await assert.rejects(
    () => testProvider(f.user.id, f.provider.id, "second@example.net"),
    /Daily safety limit/,
  );
  await rebuildSafety(f.user.id);
  const capacity = await safetyCapacity(f.user.id, f.input.from, f.campaign.id);
  assert.equal(capacity.usage.find((b) => b.scope === "account")!.used, 1);
  assert.equal(
    capacity.usage.find((b) => b.scope.startsWith("campaign:"))!.used,
    0,
  );
  await processDelivery(f.deliveries[0].id);
  assert.equal(
    await db.deliveryAttempt.count({ where: { userId: f.user.id } }),
    0,
  );
});
test("the minimum sample crossing on a later acceptance evaluates earlier complaints", async () => {
  const f = await acceptedFixture(100);
  const last = f.deliveries[99];
  await db.deliveryAttempt.deleteMany({ where: { deliveryId: last.id } });
  await db.delivery.update({
    where: { id: last.id },
    data: { state: "PENDING", acceptedAt: null },
  });
  await ingestEvent(f.provider.id, {
    eventKey: "early-complaint",
    messageId: f.deliveries[0].id,
    recipient: f.deliveries[0].email,
    kind: "complaint",
    occurredAt: new Date(),
  });
  assert.equal((await getSafetySettings(f.user.id)).pausedReason, null);
  await processDelivery(last.id);
  assert.match((await getSafetySettings(f.user.id)).pausedReason!, /Complaint/);
});

test("Redis rebuild racing live claims preserves the shared account ceiling", async () => {
  const f = await fixture(20, { accountDaily: 10 });
  for (const d of f.deliveries.slice(0, 3)) await processDelivery(d.id);
  await redis.del(`safety:{${f.user.id}}`);
  await Promise.all([
    ...f.deliveries.slice(3).map((d) => processDelivery(d.id)),
    rebuildSafety(f.user.id),
    rebuildSafety(f.user.id),
  ]);
  const count = await db.deliveryAttempt.count({
    where: { userId: f.user.id, transmissionStartedAt: { not: null } },
  });
  assert.equal(count, 10);
  assert.equal(
    (await safetyCapacity(f.user.id, f.input.from)).usage.find(
      (b) => b.scope === "account",
    )!.used,
    10,
  );
});
