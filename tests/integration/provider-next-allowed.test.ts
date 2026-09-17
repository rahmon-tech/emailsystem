import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import { createCampaign, prepareCampaign } from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";

const users: string[] = [];

async function fixture() {
  const user = await db.user.create({
    data: {
      email: `provider-next-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-only",
    },
  });
  users.push(user.id);
  const provider = await saveProvider(user.id, {
    name: "Next allowed provider",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
    perSecond: 100,
    perMinute: 1000,
    concurrency: 10,
  });
  assert(provider);
  const list = await importRecipients(
    user.id,
    Buffer.from("controlled@example.net"),
    "provider-next.txt",
  );
  const campaign = await createCampaign(user.id, {
    name: "Provider next allowed",
    importId: list.id,
    from: "sender@example.com",
    subject: "Provider next allowed",
    html: "<p>Provider next allowed</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const delivery = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  return { user, provider, campaign, delivery };
}

after(async () => {
  if (users.length) {
    await db.deliveryAttempt.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
  await redis.quit();
});

test("a temporary rejection never shortens a longer provider cooldown established while transport is in flight", async () => {
  const f = await fixture();
  const longerCooldown = new Date(Date.now() + 5 * 60_000);

  await processDelivery(f.delivery.id, async () => {
    await db.providerConnection.update({
      where: { id: f.provider.id },
      data: { cooldownUntil: longerCooldown },
    });
    return {
      status: "rejected" as const,
      error: {
        category: "temporary" as const,
        message: "Temporary provider pressure.",
        retryAfterMs: 10_000,
      },
    };
  });

  const provider = await db.providerConnection.findUniqueOrThrow({
    where: { id: f.provider.id },
    select: { cooldownUntil: true },
  });
  assert(provider.cooldownUntil);
  assert(
    provider.cooldownUntil.getTime() >= longerCooldown.getTime(),
    "a shorter retry cooldown must not overwrite a later existing cooldown",
  );
});

test("when every authorized provider is cooling down the campaign waits for the real earliest provider slot", async () => {
  const f = await fixture();
  const cooldownUntil = new Date(Date.now() + 120_000);
  await db.providerConnection.update({
    where: { id: f.provider.id },
    data: { cooldownUntil },
  });

  await processDelivery(f.delivery.id);

  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: f.campaign.id },
    select: { safetyWaitUntil: true, safetyWaitReason: true },
  });
  assert(campaign.safetyWaitUntil);
  assert.equal(
    campaign.safetyWaitReason,
    "No healthy eligible provider · review connections, cooldowns and provider quota",
  );
  assert(
    campaign.safetyWaitUntil.getTime() >= cooldownUntil.getTime() - 1_000,
    "campaign should not wake before the earliest provider cooldown expires",
  );
  assert(
    campaign.safetyWaitUntil.getTime() <= cooldownUntil.getTime() + 2_000,
    "campaign should schedule against the provider cooldown rather than a generic fallback",
  );
});
