import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { providerAdaptiveKey } from "@emailsystem/core/dispatcher";
import { redis } from "@emailsystem/core/redis";
import { GET } from "../../apps/web/app/api/campaigns/[id]/provider-status/route.ts";

const users: string[] = [];
const adaptiveKeys: string[] = [];

after(async () => {
  if (adaptiveKeys.length) await redis.del(...adaptiveKeys);
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

test("campaign provider status is tenant scoped and follows campaign transport scope", async () => {
  const owner = await createUser(
    `provider-status-${crypto.randomUUID()}@example.com`,
    "Campaign provider status password 2026",
  );
  const other = await createUser(
    `provider-status-${crypto.randomUUID()}@example.com`,
    "Other campaign provider status password 2026",
  );
  users.push(owner.id, other.id);
  const ownerSession = await login(
    owner.email,
    "Campaign provider status password 2026",
    "test-ip",
  );
  const otherSession = await login(
    other.email,
    "Other campaign provider status password 2026",
    "test-ip",
  );

  const domain = await db.authorizedDomain.create({
    data: { userId: owner.id, domain: "example.com", status: "VERIFIED" },
  });
  const sender = await db.senderIdentity.create({
    data: {
      userId: owner.id,
      authorizedDomainId: domain.id,
      localPart: "sender",
      email: "sender@example.com",
      enabled: true,
    },
  });
  const now = Date.now();
  const healthy = await db.providerConnection.create({
    data: {
      userId: owner.id,
      name: "Healthy scoped provider",
      type: "mock",
      transport: "api",
      settings: { fromEmail: sender.email },
      credentials: {},
      credentialHint: "test",
      enabled: true,
      health: "HEALTHY",
      perSecond: 10,
      perMinute: 100,
      concurrency: 2,
    },
  });
  const cooling = await db.providerConnection.create({
    data: {
      userId: owner.id,
      name: "Cooling scoped provider",
      type: "mock",
      transport: "api",
      settings: { fromEmail: sender.email },
      credentials: {},
      credentialHint: "test",
      enabled: true,
      health: "HEALTHY",
      perSecond: 10,
      perMinute: 60,
      concurrency: 2,
      cooldownUntil: new Date(now + 60_000),
    },
  });
  for (const provider of [healthy, cooling])
    await db.providerDomainAuthorization.create({
      data: {
        userId: owner.id,
        providerConnectionId: provider.id,
        authorizedDomainId: domain.id,
        status: "VERIFIED",
        scope: "DOMAIN_WIDE",
        verifiedAt: new Date(now),
      },
    });

  const campaign = await db.campaign.create({
    data: {
      userId: owner.id,
      senderIdentityId: sender.id,
      name: "Provider status campaign",
      state: "SENDING",
      message: {
        from: sender.email,
        cc: [],
        bcc: [],
        attachments: [],
      },
      importId: crypto.randomUUID(),
      intendedRecipientCount: 5,
      recipientCount: 5,
      startKey: crypto.randomUUID(),
    },
  });

  const adaptiveKey = providerAdaptiveKey(owner.id, healthy.id);
  adaptiveKeys.push(adaptiveKey);
  await redis.set(adaptiveKey, "2");

  const origin = new URL(process.env.APP_URL!).origin;
  const call = (token: string) =>
    GET(
      new Request(origin + `/api/campaigns/${campaign.id}/provider-status`, {
        headers: { Cookie: `${sessionCookie}=${token}` },
      }),
      { params: Promise.resolve({ id: campaign.id }) },
    );

  const response = await call(ownerSession.token);
  assert.equal(response.status, 200);
  const status = (await response.json()) as {
    scopedProviderCount: number;
    eligibleProviderCount: number;
    campaignBlockReason: string | null;
    providers: {
      id: string;
      eligible: boolean;
      unavailableReason: string | null;
      configuredPerMinute: number;
      effectivePerMinute: number;
      pressure: string;
    }[];
  };
  assert.equal(status.campaignBlockReason, null);
  assert.equal(status.scopedProviderCount, 2);
  assert.equal(status.eligibleProviderCount, 1);
  const healthyRow = status.providers.find((row) => row.id === healthy.id)!;
  assert.equal(healthyRow.eligible, true);
  assert.equal(healthyRow.configuredPerMinute, 100);
  assert.equal(healthyRow.effectivePerMinute, 50);
  assert.equal(healthyRow.pressure, "slowed");
  const coolingRow = status.providers.find((row) => row.id === cooling.id)!;
  assert.equal(coolingRow.eligible, false);
  assert.equal(coolingRow.pressure, "cooldown");
  assert.match(coolingRow.unavailableReason ?? "", /cooling down/i);

  const profile = await db.experimentProfile.create({
    data: {
      userId: owner.id,
      name: "Provider scope proof",
      authorizationRef: "AUTH-PROVIDER-STATUS",
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 1800,
      providerScopes: {
        create: [{ userId: owner.id, providerId: healthy.id }],
      },
      senderScopes: {
        create: [{ userId: owner.id, senderIdentityId: sender.id }],
      },
    },
  });
  const run = await db.experimentRun.create({
    data: {
      userId: owner.id,
      profileId: profile.id,
      profileVersion: 1,
      authorizationRef: profile.authorizationRef,
      state: "RUNNING",
      maxRecipients: 10,
      maxAttempts: 20,
      maxDurationSeconds: 1800,
      startedAt: new Date(now),
      expiresAt: new Date(now + 30 * 60_000),
    },
  });
  await db.campaign.update({
    where: { id: campaign.id },
    data: { experimentRunId: run.id },
  });

  const scopedResponse = await call(ownerSession.token);
  assert.equal(scopedResponse.status, 200);
  const scoped = (await scopedResponse.json()) as typeof status;
  assert.equal(scoped.scopedProviderCount, 1);
  assert.equal(scoped.eligibleProviderCount, 1);
  assert.deepEqual(scoped.providers.map((row) => row.id), [healthy.id]);

  assert.equal((await call(otherSession.token)).status, 404);
});
