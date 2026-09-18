import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import {
  addSenderIdentities,
  listSenders,
  selectDeliverySender,
} from "@emailsystem/core/senders";
import { importRecipients } from "@emailsystem/core/imports";
import {
  createCampaign,
  preflight,
  prepareCampaign,
} from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";

const owners: string[] = [];
after(async () => {
  // Campaigns intentionally restrict deletion of their selected sender. Remove
  // the campaign graph first so tenant teardown cannot race that restriction.
  await db.campaign.deleteMany({ where: { userId: { in: owners } } });
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
  await redis.quit();
});

async function userFixture(prefix: string) {
  const user = await createUser(
    `${prefix}-${crypto.randomUUID()}@example.net`,
    "Isolated sender identity password 2026",
  );
  owners.push(user.id);
  return user;
}

test("domain-wide authorization supports bulk aliases above fifty and keeps one campaign sender", async () => {
  const user = await userFixture("domain-wide");
  const provider = await saveProvider(user.id, {
    name: "Mock domain proof",
    type: "mock",
    transport: "api",
    settings: { fromEmail: "primary@example.com", fromName: "Primary" },
    credentials: {},
    perSecond: 10,
    perMinute: 100,
    concurrency: 2,
  });
  assert(provider);
  const domain = (await listSenders(user.id)).domains[0];
  await addSenderIdentities(user.id, domain.id, {
    localParts: Array.from({ length: 55 }, (_, index) => `team-${index + 1}`),
    displayName: "Example Team",
    replyTo: "reply@example.com",
  });
  const catalog = await listSenders(user.id);
  assert.equal(catalog.domains[0].senders.length, 56);
  assert(
    catalog.domains[0].senders.every((sender) =>
      sender.availableProviderIds.includes(provider.id),
    ),
  );
  const sender = catalog.domains[0].senders.find(
    (candidate) => candidate.localPart === "team-55",
  )!;
  const imported = await importRecipients(
    user.id,
    Buffer.from("one@example.net\ntwo@example.net"),
    "recipients.txt",
  );
  const input = {
    name: "Stable sender",
    senderIdentityId: sender.id,
    importId: imported.id,
    subject: "Stable sender",
    html: "<p>Stable sender.</p>",
    startKey: crypto.randomUUID(),
  };
  const flight = await preflight(user.id, input);
  assert(flight.ready);
  assert.equal(flight.sender.email, "team-55@example.com");
  const campaign = await createCampaign(user.id, input);
  assert.equal(campaign.senderIdentityId, sender.id);
  assert.equal((campaign.message as { from: string }).from, sender.email);
  await prepareCampaign(campaign.id);
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
  });
  const observed: string[] = [];
  for (const delivery of deliveries)
    await processDelivery(delivery.id, async (_connection, message) => {
      observed.push(message.from);
      return {
        status: "accepted",
        providerMessageId: crypto.randomUUID(),
      };
    });
  assert.deepEqual(observed, [sender.email, sender.email]);
});

test("address-specific proof does not authorize sibling aliases or foreign/arbitrary senders", async () => {
  const user = await userFixture("address-only");
  await saveProvider(
    user.id,
    {
      name: "Mailjet address proof",
      type: "mailjet",
      transport: "api",
      settings: { fromEmail: "verified@example.org" },
      credentials: {
        apiKey: "synthetic-mailjet-key",
        secretKey: "synthetic-mailjet-secret",
      },
    },
    undefined,
    {
      fetch: async () => Response.json({ Messages: [{ Status: "success" }] }),
    },
  );
  const domain = (await listSenders(user.id)).domains[0];
  await addSenderIdentities(user.id, domain.id, {
    localParts: ["unproven"],
  });
  const catalog = await listSenders(user.id);
  const verified = catalog.domains[0].senders.find(
    (sender) => sender.localPart === "verified",
  )!;
  const unproven = catalog.domains[0].senders.find(
    (sender) => sender.localPart === "unproven",
  )!;
  assert.equal(verified.availableProviderIds.length, 1);
  assert.equal(unproven.availableProviderIds.length, 0);
  const imported = await importRecipients(
    user.id,
    Buffer.from("reader@example.net"),
    "recipients.txt",
  );
  const common = {
    name: "Sender boundary",
    importId: imported.id,
    subject: "Sender boundary",
    html: "<p>Boundary.</p>",
  };
  assert(
    !(await preflight(user.id, { ...common, senderIdentityId: unproven.id }))
      .ready,
  );
  await assert.rejects(
    () => preflight(user.id, { ...common, from: "arbitrary@example.org" }),
    /verified From address/i,
  );
  const other = await userFixture("foreign-sender");
  const otherImport = await importRecipients(
    other.id,
    Buffer.from("other-reader@example.net"),
    "other-recipients.txt",
  );
  await assert.rejects(
    () =>
      preflight(other.id, {
        ...common,
        importId: otherImport.id,
        senderIdentityId: verified.id,
      }),
    /authorized sender identity/i,
  );
});

test("changing a provider domain retires its old sender authorization", async () => {
  const user = await userFixture("domain-change");
  const provider = await saveProvider(user.id, {
    name: "Changing provider",
    type: "mock",
    transport: "api",
    settings: { fromEmail: "first@old-example.com" },
    credentials: {},
  });
  assert(provider);
  const before = await listSenders(user.id);
  const oldSender = before.domains
    .flatMap((domain) => domain.senders)
    .find((sender) => sender.email === "first@old-example.com")!;
  assert.deepEqual(oldSender.availableProviderIds, [provider.id]);

  await saveProvider(
    user.id,
    {
      name: "Changing provider",
      type: "mock",
      transport: "api",
      settings: { fromEmail: "second@new-example.com" },
      credentials: {},
    },
    provider.id,
  );
  const after = await listSenders(user.id);
  const retired = after.domains
    .flatMap((domain) => domain.senders)
    .find((sender) => sender.id === oldSender.id)!;
  const current = after.domains
    .flatMap((domain) => domain.senders)
    .find((sender) => sender.email === "second@new-example.com")!;
  assert.deepEqual(retired.availableProviderIds, []);
  assert.deepEqual(current.availableProviderIds, [provider.id]);
  assert.equal(
    after.domains.find((domain) => domain.domain === "old-example.com")?.status,
    "UNVERIFIED",
  );
});


test("domain selection creates a bounded verified alias pool and chooses aliases deterministically", async () => {
  const user = await userFixture("domain-pool");
  const provider = await saveProvider(user.id, {
    name: "Domain pool provider",
    type: "mock",
    transport: "api",
    settings: {
      fromEmail: "info@example-pool.com",
      senderDomain: "example-pool.com",
      senderAliases: ["info", "support", "hello", "sales"],
      fromName: "Example Pool",
    },
    credentials: {},
    perSecond: 20,
    perMinute: 1000,
    concurrency: 4,
    dailyBudget: 500,
    monthlyBudget: 5000,
  });
  assert(provider);
  const catalog = await listSenders(user.id);
  const domain = catalog.domains.find(
    (candidate) => candidate.domain === "example-pool.com",
  )!;
  assert.equal(domain.status, "VERIFIED");
  assert.deepEqual(
    domain.senders.map((sender) => sender.localPart).sort(),
    ["hello", "info", "sales", "support"],
  );
  assert(
    domain.senders.every((sender) =>
      sender.availableProviderIds.includes(provider.id),
    ),
  );

  const imported = await importRecipients(
    user.id,
    Buffer.from("one@example.net\ntwo@example.net"),
    "domain-pool.txt",
  );
  const flight = await preflight(user.id, {
    name: "Domain pool campaign",
    senderDomainId: domain.id,
    importId: imported.id,
    subject: "Domain pool",
    html: "<p>Domain pool.</p>",
  });
  assert(flight.ready);
  assert.equal(flight.sender.domainId, domain.id);
  assert.equal(flight.sender.aliasCount, 4);
  assert.equal(flight.providers.length, 1);

  const campaign = await createCampaign(user.id, {
    name: "Domain pool campaign",
    senderDomainId: domain.id,
    importId: imported.id,
    subject: "Domain pool",
    html: "<p>Domain pool.</p>",
    startKey: crypto.randomUUID(),
  });
  const snapshot = campaign.message as {
    senderPool?: { enabled?: boolean; aliasCount?: number };
  };
  assert.equal(snapshot.senderPool?.enabled, true);
  assert.equal(snapshot.senderPool?.aliasCount, 4);

  const anchor = campaign.senderIdentityId!;
  const selections = await db.$transaction(async (tx) =>
    Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        selectDeliverySender(
          tx,
          user.id,
          anchor,
          "delivery-" + index,
          true,
        ),
      ),
    ),
  );
  const chosen = selections.map((selection) => selection!.sender.email);
  assert(chosen.every((email) => email.endsWith("@example-pool.com")));
  assert(new Set(chosen).size > 1);
  const repeated = await db.$transaction((tx) =>
    selectDeliverySender(tx, user.id, anchor, "delivery-7", true),
  );
  assert.equal(repeated!.sender.email, chosen[7]);
});

test("address-specific providers do not widen a domain alias pool", async () => {
  const user = await userFixture("address-pool");
  const provider = await saveProvider(
    user.id,
    {
      name: "Address-only provider",
      type: "mailjet",
      transport: "api",
      settings: {
        fromEmail: "verified@address-pool.example",
        senderDomain: "address-pool.example",
        senderAliases: ["verified", "unproven"],
      },
      credentials: {
        apiKey: "synthetic-mailjet-key",
        secretKey: "synthetic-mailjet-secret",
      },
    },
    undefined,
    {
      fetch: async () => Response.json({ Messages: [{ Status: "success" }] }),
    },
  );
  assert(provider);
  const domain = (await listSenders(user.id)).domains.find(
    (candidate) => candidate.domain === "address-pool.example",
  )!;
  const verified = domain.senders.find(
    (sender) => sender.localPart === "verified",
  )!;
  const unproven = domain.senders.find(
    (sender) => sender.localPart === "unproven",
  )!;
  assert.deepEqual(verified.availableProviderIds, [provider.id]);
  assert.deepEqual(unproven.availableProviderIds, []);

  const choices = await db.$transaction(async (tx) =>
    Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        selectDeliverySender(
          tx,
          user.id,
          verified.id,
          "address-delivery-" + index,
          true,
        ),
      ),
    ),
  );
  assert(
    choices.every(
      (selection) => selection?.sender.email === verified.email,
    ),
  );
});


test("domain-first preflight combines only providers authorized for the selected domain", async () => {
  const user = await userFixture("domain-capacity");
  const first = await saveProvider(user.id, {
    name: "Primary domain A",
    type: "mock",
    transport: "api",
    settings: {
      fromEmail: "info@alpha.example.com",
      senderDomain: "alpha.example.com",
      senderAliases: ["info", "support"],
    },
    credentials: {},
    dailyBudget: 40,
    monthlyBudget: 1000,
    perSecond: 10,
    perMinute: 600,
    concurrency: 2,
  });
  const second = await saveProvider(user.id, {
    name: "Secondary domain A",
    type: "mock",
    transport: "api",
    settings: {
      fromEmail: "news@alpha.example.com",
      senderDomain: "alpha.example.com",
      senderAliases: ["news", "updates"],
    },
    credentials: {},
    dailyBudget: 60,
    monthlyBudget: 1000,
    perSecond: 10,
    perMinute: 600,
    concurrency: 2,
  });
  const other = await saveProvider(user.id, {
    name: "Domain B only",
    type: "mock",
    transport: "api",
    settings: {
      fromEmail: "hello@beta.example.com",
      senderDomain: "beta.example.com",
      senderAliases: ["hello"],
    },
    credentials: {},
    dailyBudget: 25,
    monthlyBudget: 500,
    perSecond: 10,
    perMinute: 600,
    concurrency: 2,
  });
  assert(first && second && other);

  const catalog = await listSenders(user.id);
  const alpha = catalog.domains.find(
    (domain) => domain.domain === "alpha.example.com",
  )!;
  const beta = catalog.domains.find(
    (domain) => domain.domain === "beta.example.com",
  )!;
  const imported = await importRecipients(
    user.id,
    Buffer.from("reader@example.net"),
    "domain-capacity.txt",
  );
  const common = {
    name: "Domain capacity",
    importId: imported.id,
    subject: "Capacity",
    html: "<p>Capacity.</p>",
  };

  const alphaFlight = await preflight(user.id, {
    ...common,
    senderDomainId: alpha.id,
  });
  assert(alphaFlight.ready);
  assert.deepEqual(
    alphaFlight.providers.map((provider) => provider.id).sort(),
    [first.id, second.id].sort(),
  );
  assert.equal(alphaFlight.safety.availableUnits, 100);

  const betaFlight = await preflight(user.id, {
    ...common,
    senderDomainId: beta.id,
  });
  assert(betaFlight.ready);
  assert.deepEqual(
    betaFlight.providers.map((provider) => provider.id),
    [other.id],
  );
  assert.equal(betaFlight.safety.availableUnits, 25);
});


test("multi-domain campaign drops an unavailable domain and continues through a healthy route", async () => {
  const user = await userFixture("multi-domain-failover");
  const alphaProvider = await saveProvider(user.id, {
    name: "Alpha route",
    type: "mock",
    transport: "api",
    settings: {
      fromEmail: "info@alpha-pool.example",
      senderDomain: "alpha-pool.example",
      senderAliases: ["info", "support"],
    },
    credentials: {},
    dailyBudget: 100,
    monthlyBudget: 1000,
    perSecond: 100,
    perMinute: 6000,
    concurrency: 10,
  });
  const betaProvider = await saveProvider(user.id, {
    name: "Beta route",
    type: "mock",
    transport: "api",
    settings: {
      fromEmail: "hello@beta-pool.example",
      senderDomain: "beta-pool.example",
      senderAliases: ["hello", "news"],
    },
    credentials: {},
    dailyBudget: 100,
    monthlyBudget: 1000,
    perSecond: 100,
    perMinute: 6000,
    concurrency: 10,
  });
  assert(alphaProvider && betaProvider);
  const catalog = await listSenders(user.id);
  const alpha = catalog.domains.find(
    (domain) => domain.domain === "alpha-pool.example",
  )!;
  const beta = catalog.domains.find(
    (domain) => domain.domain === "beta-pool.example",
  )!;
  const imported = await importRecipients(
    user.id,
    Buffer.from("one@example.net\ntwo@example.net\nthree@example.net"),
    "multi-domain.txt",
  );
  const input = {
    name: "Multi-domain failover",
    senderDomainIds: [alpha.id, beta.id],
    importId: imported.id,
    subject: "Pool",
    html: "<p>Pool.</p>",
    startKey: crypto.randomUUID(),
  };
  const flight = await preflight(user.id, input);
  assert(flight.ready);
  assert.equal(flight.sender.domainCount, 2);
  assert.deepEqual(new Set(flight.sender.domains), new Set([
    "alpha-pool.example",
    "beta-pool.example",
  ]));
  assert.deepEqual(
    new Set(flight.providers.map((provider) => provider.id)),
    new Set([alphaProvider.id, betaProvider.id]),
  );

  const campaign = await createCampaign(user.id, input);
  await prepareCampaign(campaign.id);
  await db.providerConnection.update({
    where: { id: alphaProvider.id },
    data: { enabled: false, health: "DISABLED" },
  });
  const deliveries = await db.delivery.findMany({
    where: { campaignId: campaign.id },
    orderBy: { id: "asc" },
  });
  for (const delivery of deliveries)
    await processDelivery(delivery.id, async () => ({
      status: "accepted" as const,
      providerMessageId: crypto.randomUUID(),
    }));
  const attempts = await db.deliveryAttempt.findMany({
    where: {
      userId: user.id,
      delivery: { campaignId: campaign.id },
      transmissionStartedAt: { not: null },
    },
    select: { providerId: true, senderDomain: true },
  });
  assert.equal(attempts.length, 3);
  assert(attempts.every((attempt) => attempt.providerId === betaProvider.id));
  assert(attempts.every((attempt) => attempt.senderDomain === "beta-pool.example"));
});
