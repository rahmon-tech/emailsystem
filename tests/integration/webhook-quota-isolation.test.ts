import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { saveProvider } from "@emailsystem/core/providers";
import { receiveWebhook } from "@emailsystem/core/events";
import { redis } from "@emailsystem/core/redis";
import { AppError } from "@emailsystem/core/errors";

const users: string[] = [];
const providerKeys: string[] = [];

after(async () => {
  if (providerKeys.length) await redis.del(...providerKeys);
  if (users.length) {
    await db.providerEvent.deleteMany({
      where: { provider: { userId: { in: users } } },
    });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db.$disconnect();
  await redis.quit();
});

async function fixture() {
  const user = await db.user.create({
    data: {
      email: `webhook-quota-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-only",
    },
  });
  users.push(user.id);

  const provider = await saveProvider(user.id, {
    name: "Webhook quota proof",
    type: "mock",
    transport: "api",
    credentials: { webhookSecret: "webhook-secret" },
    settings: { fromEmail: "sender@example.com" },
    perSecond: 10,
    perMinute: 100,
    concurrency: 2,
  });
  assert(provider);

  const providerKey = `webhook:provider:${provider.id}`;
  providerKeys.push(providerKey);
  await redis.del(providerKey);

  const raw = JSON.stringify({
    event: "delivered",
    messageId: "message-1",
    email: "recipient@example.net",
    id: "event-1",
    timestamp: new Date().toISOString(),
  });
  const url = new URL(`https://example.com/api/webhooks/${provider.id}`);
  const authorization =
    "Basic " + Buffer.from("emailsystem:webhook-secret").toString("base64");

  return { provider, providerKey, raw, url, authorization };
}

test("invalid webhook authentication cannot spend the provider callback quota", async () => {
  const f = await fixture();

  await assert.rejects(
    () =>
      receiveWebhook(
        f.provider.id,
        f.raw,
        new Headers({ authorization: "Basic invalid" }),
        f.url,
      ),
    (error: unknown) =>
      error instanceof AppError && error.code === "SIGNATURE",
  );

  assert.equal(await redis.get(f.providerKey), null);

  await redis.set(f.providerKey, "2999", "EX", 60);
  assert.equal(
    await receiveWebhook(
      f.provider.id,
      f.raw,
      new Headers({ authorization: f.authorization }),
      f.url,
    ),
    1,
  );
  assert.equal(await redis.get(f.providerKey), "3000");

  await assert.rejects(
    () =>
      receiveWebhook(
        f.provider.id,
        f.raw,
        new Headers({ authorization: f.authorization }),
        f.url,
      ),
    (error: unknown) => error instanceof AppError && error.code === "RATE",
  );
});

test("authenticated malformed webhook payloads fail as bounded client errors", async () => {
  const f = await fixture();

  await assert.rejects(
    () =>
      receiveWebhook(
        f.provider.id,
        "{",
        new Headers({ authorization: f.authorization }),
        f.url,
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.status === 400 &&
      error.code === "WEBHOOK_PAYLOAD",
  );
});
