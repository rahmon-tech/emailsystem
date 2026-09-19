import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import {
  createUser,
  login,
  sessionCookie,
  logout,
  userFromToken,
} from "@emailsystem/core/auth";
import { api } from "@emailsystem/core/api";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign, prepareCampaign } from "@emailsystem/core/campaigns";
const users: string[] = [];
after(async () => {
  await db.deliveryAttempt.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  await redis.quit();
});
test("HTTP sessions, CSRF, tenant access and secret responses are enforced on the server", async () => {
  const u = await createUser(
    "http-" + crypto.randomUUID() + "@example.com",
    "A strong test password 2026",
  );
  const b = await createUser(
    "http-" + crypto.randomUUID() + "@example.com",
    "Another strong password 2026",
  );
  users.push(u.id, b.id);
  await assert.rejects(() => login(u.email, "incorrect", "test-ip"));
  const session = await login(
    u.email,
    "A strong test password 2026",
    "test-ip",
  );
  const other = await login(b.email, "Another strong password 2026", "test-ip");
  const origin = new URL(process.env.APP_URL!).origin;
  const call = (
    path: string,
    token: string,
    method = "GET",
    body?: unknown,
    requestOrigin = origin,
  ) =>
    api(
      new Request(origin + "/api/" + path, {
        method,
        headers: {
          Cookie: sessionCookie + "=" + token,
          Origin: requestOrigin,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      path.split("/"),
    );
  assert.equal((await call("providers", "")).status, 401);
  assert.equal(
    (
      await call(
        "providers",
        session.token,
        "POST",
        {},
        "https://attacker.invalid",
      )
    ).status,
    403,
  );

  const draftConnectionId = crypto.randomUUID();
  const draftCreate = await call("providers", session.token, "POST", {
    connectionId: draftConnectionId,
    name: "Preallocated webhook",
    type: "mock",
    transport: "api",
    settings: { fromEmail: "webhook@example.com" },
    credentials: {},
  });
  assert.equal(draftCreate.status, 201);
  assert.equal((await draftCreate.json()).id, draftConnectionId);

  const collision = await call("providers", session.token, "POST", {
    connectionId: draftConnectionId,
    name: "Must not overwrite",
    type: "mock",
    transport: "api",
    settings: { fromEmail: "other@example.com" },
    credentials: {},
  });
  assert.equal(collision.status, 409);
  assert.equal(
    (
      await db.providerConnection.findUniqueOrThrow({
        where: { id: draftConnectionId },
        select: { name: true },
      })
    ).name,
    "Preallocated webhook",
  );
  const provider = await saveProvider(u.id, {
    name: "Confidential",
    type: "mock",
    transport: "api",
    credentials: { apiKey: "test-only-confidential-marker" },
    settings: { fromEmail: "sender@example.com" },
  });
  assert(provider);
  const response = await call("providers", session.token);
  const raw = await response.text();
  assert(!raw.includes("test-only-confidential-marker"));
  assert(!raw.includes("ciphertext"));
  assert.deepEqual(await (await call("providers", other.token)).json(), []);
  const list = await importRecipients(
    u.id,
    Buffer.from("person@example.net"),
    "people.txt",
  );
  const campaign = await createCampaign(u.id, {
    name: "Owned",
    from: "sender@example.com",
    subject: "Owned",
    html: "<p>Owned message</p>",
    importId: list.id,
    startKey: crypto.randomUUID(),
  });
  await prepareCampaign(campaign.id);
  for (const path of [
    "campaigns/" + campaign.id,
    "campaigns/" + campaign.id + "/deliveries",
    "campaigns/" + campaign.id + "/export",
    "providers/" + provider.id + "/verify",
  ])
    assert.equal(
      (
        await call(
          path,
          other.token,
          path.endsWith("/verify") ? "POST" : "GET",
          path.endsWith("/verify") ? {} : undefined,
        )
      ).status,
      404,
    );
  const listOther = await call("imports", other.token);
  assert.deepEqual(await listOther.json(), []);
  await logout(session.token);
  assert.equal(await userFromToken(session.token), null);
  assert.equal((await call("providers", session.token)).status, 401);
});
