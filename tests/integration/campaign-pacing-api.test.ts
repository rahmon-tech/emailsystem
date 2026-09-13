import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign, prepareCampaign } from "@emailsystem/core/campaigns";
import { processDelivery } from "@emailsystem/core/engine";
import { GET } from "../../apps/web/app/api/campaigns/[id]/pacing/route.ts";

const users: string[] = [];

after(async () => {
  await db.deliveryAttempt.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("campaign pacing API is tenant scoped and reports persisted dispatch evidence", async () => {
  const owner = await createUser(
    `pace-${crypto.randomUUID()}@example.com`,
    "A strong pacing password 2026",
  );
  const other = await createUser(
    `pace-${crypto.randomUUID()}@example.com`,
    "Another pacing password 2026",
  );
  users.push(owner.id, other.id);
  const ownerSession = await login(
    owner.email,
    "A strong pacing password 2026",
    "test-ip",
  );
  const otherSession = await login(
    other.email,
    "Another pacing password 2026",
    "test-ip",
  );

  await saveProvider(owner.id, {
    name: "Pacing mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
  });
  const list = await importRecipients(
    owner.id,
    Buffer.from("one@example.net\ntwo@example.net\nthree@example.net"),
    "pace.txt",
  );
  const campaign = await createCampaign(owner.id, {
    name: "Pacing campaign",
    importId: list.id,
    from: "sender@example.com",
    subject: "Pacing",
    html: "<p>Pacing</p>",
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  const first = await db.delivery.findFirstOrThrow({
    where: { campaignId: campaign.id },
    orderBy: { id: "asc" },
  });
  await processDelivery(first.id);

  const origin = new URL(process.env.APP_URL!).origin;
  const call = (token: string) =>
    GET(
      new Request(origin + `/api/campaigns/${campaign.id}/pacing`, {
        headers: { Cookie: `${sessionCookie}=${token}` },
      }),
      { params: Promise.resolve({ id: campaign.id }) },
    );

  const response = await call(ownerSession.token);
  assert.equal(response.status, 200);
  const pacing = (await response.json()) as {
    sampleSize: number;
    remaining: number;
    campaignState: string;
    observedWindowSeconds: number;
  };
  assert.equal(pacing.sampleSize, 1);
  assert.equal(pacing.remaining, 2);
  assert.equal(pacing.campaignState, "SENDING");
  assert.equal(pacing.observedWindowSeconds, 300);

  assert.equal((await call(otherSession.token)).status, 404);
});
