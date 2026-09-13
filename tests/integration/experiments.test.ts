import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import {
  GET as getProfiles,
  POST as postProfile,
} from "../../apps/web/app/api/experiment-profiles/route.ts";
import {
  GET as getRuns,
  POST as postRun,
} from "../../apps/web/app/api/experiment-runs/route.ts";
import { POST as postRunAction } from "../../apps/web/app/api/experiment-runs/[id]/route.ts";
import {
  GET as getKillSwitch,
  POST as postKillSwitch,
} from "../../apps/web/app/api/experiment-kill-switch/route.ts";

const users: string[] = [];

after(async () => {
  await db.experimentRun.deleteMany({ where: { userId: { in: users } } });
  await db.experimentProfile.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});

async function seedScope(userId: string, suffix: string) {
  const domain = await db.authorizedDomain.create({
    data: {
      userId,
      domain: `${suffix}.example.com`,
      status: "VERIFIED",
    },
  });
  const sender = await db.senderIdentity.create({
    data: {
      userId,
      authorizedDomainId: domain.id,
      localPart: "sender",
      email: `sender@${suffix}.example.com`,
      enabled: true,
    },
  });
  const provider = await db.providerConnection.create({
    data: {
      userId,
      name: `${suffix} provider`,
      type: "mock",
      transport: "api",
      settings: { fromEmail: sender.email },
      credentials: {},
      credentialHint: "test",
      enabled: true,
      health: "HEALTHY",
      perSecond: 10,
      perMinute: 120,
      concurrency: 2,
    },
  });
  return { provider, sender };
}

test("authorized experiment profiles and runs enforce tenant scope, hard bounds and kill switch state", async () => {
  const ownerPassword = "A strong experiment password 2026";
  const otherPassword = "Another experiment password 2026";
  const owner = await createUser(
    `experiment-${crypto.randomUUID()}@example.com`,
    ownerPassword,
  );
  const other = await createUser(
    `experiment-${crypto.randomUUID()}@example.com`,
    otherPassword,
  );
  users.push(owner.id, other.id);
  const ownerSession = await login(owner.email, ownerPassword, "experiment-owner");
  const otherSession = await login(other.email, otherPassword, "experiment-other");
  const ownerScope = await seedScope(owner.id, `owner-${crypto.randomUUID()}`);
  const otherScope = await seedScope(other.id, `other-${crypto.randomUUID()}`);

  const origin = new URL(process.env.APP_URL!).origin;
  const jsonRequest = (path: string, token: string, body: unknown) =>
    new Request(origin + path, {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}=${token}`,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const baseProfile = {
    name: "Provider resilience baseline",
    authorizationRef: "AUTH-2026-EMAIL-01",
    description: "Controlled provider resilience verification.",
    providerIds: [ownerScope.provider.id],
    senderIdentityIds: [ownerScope.sender.id],
    recipients: ["alpha@example.net", "beta@example.net"],
    maxRecipients: 2,
    maxAttempts: 4,
    maxDurationSeconds: 900,
    variables: {
      pacingProfile: "smooth",
      pacingIntervalMs: 5000,
      concurrency: 2,
      transportEncoding: "provider-default",
      charset: "utf-8",
      contentMode: "html",
    },
  };

  const foreignProvider = await postProfile(
    jsonRequest("/api/experiment-profiles", ownerSession.token, {
      ...baseProfile,
      providerIds: [otherScope.provider.id],
    }),
  );
  assert.equal(foreignProvider.status, 422);
  assert.equal((await foreignProvider.json()).code, "EXPERIMENT_PROVIDER_SCOPE");

  const overRecipientLimit = await postProfile(
    jsonRequest("/api/experiment-profiles", ownerSession.token, {
      ...baseProfile,
      maxRecipients: 3,
    }),
  );
  assert.equal(overRecipientLimit.status, 422);
  assert.equal(
    (await overRecipientLimit.json()).code,
    "EXPERIMENT_RECIPIENT_LIMIT",
  );

  const createdResponse = await postProfile(
    jsonRequest("/api/experiment-profiles", ownerSession.token, baseProfile),
  );
  assert.equal(createdResponse.status, 201);
  const profile = (await createdResponse.json()) as {
    id: string;
    version: number;
    authorizationRef: string;
    _count: { recipients: number; runs: number };
  };
  assert.equal(profile.version, 1);
  assert.equal(profile.authorizationRef, "AUTH-2026-EMAIL-01");
  assert.equal(profile._count.recipients, 2);
  assert(!JSON.stringify(profile).includes("alpha@example.net"));

  const ownerProfiles = await getProfiles(
    new Request(origin + "/api/experiment-profiles", {
      headers: { Cookie: `${sessionCookie}=${ownerSession.token}` },
    }),
  );
  assert.equal(ownerProfiles.status, 200);
  assert.equal(((await ownerProfiles.json()) as unknown[]).length, 1);
  const otherProfiles = await getProfiles(
    new Request(origin + "/api/experiment-profiles", {
      headers: { Cookie: `${sessionCookie}=${otherSession.token}` },
    }),
  );
  assert.deepEqual(await otherProfiles.json(), []);

  const runResponse = await postRun(
    jsonRequest("/api/experiment-runs", ownerSession.token, {
      profileId: profile.id,
    }),
  );
  assert.equal(runResponse.status, 201);
  const run = (await runResponse.json()) as { id: string; state: string };
  assert.equal(run.state, "READY");

  const foreignStart = await postRunAction(
    jsonRequest(`/api/experiment-runs/${run.id}`, otherSession.token, {
      action: "start",
    }),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(foreignStart.status, 404);

  const startedResponse = await postRunAction(
    jsonRequest(`/api/experiment-runs/${run.id}`, ownerSession.token, {
      action: "start",
    }),
    { params: Promise.resolve({ id: run.id }) },
  );
  assert.equal(startedResponse.status, 200);
  const started = (await startedResponse.json()) as {
    state: string;
    startedAt: string;
    expiresAt: string;
  };
  assert.equal(started.state, "RUNNING");
  assert(started.startedAt);
  assert(started.expiresAt);
  assert(
    new Date(started.expiresAt).getTime() - new Date(started.startedAt).getTime() <=
      900_000,
  );

  const engagedResponse = await postKillSwitch(
    jsonRequest("/api/experiment-kill-switch", ownerSession.token, {
      engaged: true,
      reason: "Operator emergency stop",
    }),
  );
  assert.equal(engagedResponse.status, 200);
  assert.equal((await engagedResponse.json()).engaged, true);
  const stopped = await db.experimentRun.findFirstOrThrow({
    where: { id: run.id, userId: owner.id },
  });
  assert.equal(stopped.state, "STOPPED");
  assert(stopped.killSwitchAt);
  assert.equal(stopped.stopReason, "Operator emergency stop");

  const killStatus = await getKillSwitch(
    new Request(origin + "/api/experiment-kill-switch", {
      headers: { Cookie: `${sessionCookie}=${ownerSession.token}` },
    }),
  );
  assert.equal(killStatus.status, 200);
  assert.equal((await killStatus.json()).engaged, true);

  const blockedRun = await postRun(
    jsonRequest("/api/experiment-runs", ownerSession.token, {
      profileId: profile.id,
    }),
  );
  assert.equal(blockedRun.status, 409);
  assert.equal((await blockedRun.json()).code, "EXPERIMENT_KILL_SWITCH");

  const clearedResponse = await postKillSwitch(
    jsonRequest("/api/experiment-kill-switch", ownerSession.token, {
      engaged: false,
    }),
  );
  assert.equal(clearedResponse.status, 200);
  assert.equal((await clearedResponse.json()).engaged, false);

  const runs = await getRuns(
    new Request(origin + "/api/experiment-runs", {
      headers: { Cookie: `${sessionCookie}=${ownerSession.token}` },
    }),
  );
  assert.equal(runs.status, 200);
  const listedRuns = (await runs.json()) as { id: string; state: string }[];
  assert.equal(listedRuns.length, 1);
  assert.equal(listedRuns[0].id, run.id);
  assert.equal(listedRuns[0].state, "STOPPED");

  const audit = await db.auditEvent.findMany({
    where: { userId: owner.id, action: { startsWith: "experiment." } },
  });
  assert(audit.some((event) => event.action === "experiment.profile.created"));
  assert(audit.some((event) => event.action === "experiment.run.created"));
  assert(audit.some((event) => event.action === "experiment.run.started"));
  assert(audit.some((event) => event.action === "experiment.kill_switch.engaged"));
  assert(audit.some((event) => event.action === "experiment.kill_switch.cleared"));
});
