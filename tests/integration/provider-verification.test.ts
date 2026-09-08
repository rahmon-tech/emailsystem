import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { redis } from "@emailsystem/core/redis";
import { db } from "@emailsystem/db";
import {
  saveProvider,
  testProvider,
  compatible,
  unlocked,
  getConnection,
} from "@emailsystem/core/providers";
import { catalog } from "@emailsystem/providers";
import type { Dependencies, ProviderMessage } from "@emailsystem/providers";
import { connection } from "../fixtures";

let userId: string;
before(async () => {
  userId = (
    await db.user.create({
      data: {
        email: "catalog-" + crypto.randomUUID() + "@example.com",
        passwordHash: "test-only",
      },
    })
  ).id;
});
after(async () => {
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
  await redis.quit();
});
const responses: Record<string, unknown> = {
  resend: { data: [{ name: "example.com", status: "verified" }] },
  mailgun: { domain: { name: "example.com", state: "active" } },
  sendgrid: { scopes: ["mail.send"] },
  brevo: { relay: { enabled: true } },
  postmark: { ID: 123 },
  mailjet: { Messages: [{ Status: "success" }] },
  smtp2go: { data: { delivered: 42 } },
  elastic: [{ Domain: "example.com" }],
};
function input(
  type: Parameters<typeof connection>[0],
  transport?: "api" | "smtp",
) {
  const { id, ...c } = connection(type);
  assert(id);
  return {
    ...c,
    name: type + "-" + crypto.randomUUID(),
    transport: transport ?? c.transport,
  };
}
for (const def of catalog.filter((d) => d.api)) {
  test(
    def.name +
      ": Save & Verify persists encrypted credentials, state and checks",
    async () => {
      const c = input(def.id);
      let requests = 0;
      const saved = await saveProvider(userId, c, undefined, {
        fetch: async (url) => {
          requests++;
          const pending = await db.providerConnection.findFirstOrThrow({
            where: { userId, name: c.name },
          });
          assert.equal(pending.health, "TESTING");
          assert.equal(pending.enabled, false);
          assert(!JSON.stringify(pending.credentials).includes("key-secret"));
          assert.equal(unlocked(pending).credentials.apiKey, "key-secret");
          if (String(url).includes("/message-streams/"))
            return Response.json({ MessageStreamType: "Broadcast" });
          if (def.id === "brevo" && String(url).endsWith("/smtp/email"))
            return Response.json({ messageId: "sandbox-id" }, { status: 201 });
          return Response.json(responses[def.id]);
        },
      });
      assert(saved);
      assert(requests > 0);
      const healthy = ["resend", "sendgrid", "postmark", "mailjet"].includes(
        def.id,
      );
      assert.equal(saved.health, healthy ? "HEALTHY" : "UNVERIFIED");
      assert.equal(saved.enabled, healthy);
      assert.equal(compatible(saved, "sender@example.com"), healthy);
      assert(saved.verifiedAt);
      assert.equal(saved.verifications.length, 1);
      assert.equal(saved.verifications[0].status, saved.health);
      assert(!("credentials" in saved));
      assert(!JSON.stringify(saved).includes("key-secret"));
      assert.equal(
        await db.providerTestDelivery.count({
          where: { providerId: saved.id },
        }),
        0,
      );
    },
  );
}
for (const def of catalog.filter((d) => d.smtp || d.id === "smtp")) {
  test(
    def.name + ": SMTP Save & Verify persists authentication without sending",
    async () => {
      let verified = 0,
        sent = 0;
      const saved = await saveProvider(
        userId,
        input(def.id, "smtp"),
        undefined,
        {
          smtp: () => ({
            verify: async () => {
              verified++;
              return true;
            },
            sendMail: async () => {
              sent++;
              throw Error("Unexpected email");
            },
            close: () => {},
          }),
        } as unknown as Dependencies,
      );
      assert(saved);
      assert.equal(verified, 1);
      assert.equal(sent, 0);
      assert.equal(saved.health, "HEALTHY");
      assert.equal(
        await db.providerTestDelivery.count({
          where: { providerId: saved.id },
        }),
        0,
      );
      assert.match(
        JSON.stringify(saved.verifications),
        /does not prove sender/,
      );
    },
  );
}
const account = {
  SendingEnabled: true,
  ProductionAccessEnabled: true,
  SendQuota: { Max24HourSend: 1000, SentLast24Hours: 0, MaxSendRate: 14 },
};
function sesDeps(
  overrides: Record<string, unknown> = {},
  identity = true,
): Dependencies {
  return {
    ses: {
      send: async (command) =>
        (command as object).constructor.name === "GetAccountCommand"
          ? { ...account, ...overrides }
          : { VerifiedForSendingStatus: identity },
    },
  };
}
test("SES Save & Verify persists identity, quota, sandbox and enforcement states", async () => {
  for (const [dependencies, status] of [
    [sesDeps(), "HEALTHY"],
    [sesDeps({ ProductionAccessEnabled: false }), "SANDBOX"],
    [sesDeps({}, false), "SENDER_UNVERIFIED"],
    [sesDeps({ EnforcementStatus: "SHUTDOWN" }), "POLICY_BLOCKED"],
    [
      sesDeps({ SendQuota: { Max24HourSend: 10, SentLast24Hours: 10 } }),
      "THROTTLED",
    ],
  ] as const) {
    const saved = await saveProvider(
      userId,
      input("ses"),
      undefined,
      dependencies,
    );
    assert(saved);
    assert.equal(saved.health, status);
    assert.equal(saved.enabled, status === "HEALTHY");
    assert.equal(compatible(saved, "sender@example.com"), status === "HEALTHY");
    assert.equal(saved.verifications[0].status, status);
  }
});
test("failed, incomplete and malformed verification states remain outside the campaign pool", async () => {
  for (const [type, response, status] of [
    [
      "resend",
      () => Response.json({ name: "invalid_api_key" }, { status: 403 }),
      "AUTH_ERROR",
    ],
    [
      "resend",
      () => Response.json({ name: "restricted_api_key" }, { status: 401 }),
      "UNVERIFIED",
    ],
    [
      "resend",
      () =>
        Response.json({ data: [{ name: "example.com", status: "pending" }] }),
      "DOMAIN_UNVERIFIED",
    ],
    [
      "sendgrid",
      () => Response.json({ scopes: ["stats.read"] }),
      "MISSING_PERMISSION",
    ],
    [
      "brevo",
      () => Response.json({ relay: { enabled: false } }),
      "CONFIG_ERROR",
    ],
    [
      "mailgun",
      () =>
        Response.json(
          { message: "Account suspended due to enforcement" },
          { status: 403 },
        ),
      "POLICY_BLOCKED",
    ],
    ["mailjet", () => new Response("invalid-json-secret"), "DEGRADED"],
    [
      "mailgun",
      () => Response.json({ message: "Rate limited" }, { status: 429 }),
      "THROTTLED",
    ],
  ] as const) {
    const saved = await saveProvider(userId, input(type), undefined, {
      fetch: async () => response(),
    });
    assert(saved);
    assert.equal(saved.health, status);
    assert.equal(saved.enabled, false);
    assert.equal(compatible(saved, "sender@example.com"), false);
    assert.equal(saved.verifications[0].status, status);
    assert(!JSON.stringify(saved).includes("invalid-json-secret"));
  }
});
test("controlled tests persist the exact connection, recipient, mode and unique IDs without campaign statistics", async () => {
  const chosen = input("resend");
  chosen.credentials.apiKey = "chosen-sending-key";
  const saved = await saveProvider(userId, chosen, undefined, {
    fetch: async () =>
      Response.json({ name: "restricted_api_key" }, { status: 401 }),
  });
  assert(saved);
  assert.equal(saved.health, "UNVERIFIED");
  const keys = new Set<string>();
  const before = await db.deliveryAttempt.count({ where: { userId } });
  const message: ProviderMessage = {
    from: "sender@example.com",
    fromName: "",
    to: "other@example.net",
    cc: ["copy@example.net"],
    bcc: ["hidden@example.net"],
    replyTo: "",
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
    headers: {},
    attachments: [],
  };
  for (let i = 0; i < 2; i++) {
    const record = await testProvider(
      userId,
      saved.id,
      "delivered@resend.dev",
      false,
      message,
      {
        fetch: async (url, init) => {
          assert.equal(url, "https://api.resend.com/emails");
          assert.equal(
            new Headers(init?.headers).get("Authorization"),
            "Bearer chosen-sending-key",
          );
          keys.add(new Headers(init?.headers).get("Idempotency-Key")!);
          const payload = JSON.parse(String(init?.body));
          assert.deepEqual(payload.to, ["delivered@resend.dev"]);
          assert.deepEqual(payload.cc, []);
          assert.deepEqual(payload.bcc, []);
          return Response.json({ id: "controlled-" + i });
        },
      },
    );
    assert(record);
    assert.equal(record.providerId, saved.id);
    assert.equal(record.recipient, "delivered@resend.dev");
    assert.equal(record.testMode, false);
    assert.equal(record.status, "accepted");
    assert.equal(record.providerMessageId, "controlled-" + i);
    assert(record.createdAt);
  }
  assert.equal(keys.size, 2);
  assert.equal((await getConnection(userId, saved.id)).health, "HEALTHY");
  assert.equal(await db.deliveryAttempt.count({ where: { userId } }), before);
});
test("Brevo format-only tests stay unverified until an explicit delivery-capable test succeeds", async () => {
  const saved = await saveProvider(userId, input("brevo"), undefined, {
    fetch: async (url) =>
      Response.json(
        String(url).endsWith("/account")
          ? { relay: { enabled: true } }
          : { messageId: "sandbox-save" },
      ),
  });
  assert(saved);
  for (const testMode of [true, false]) {
    const record = await testProvider(
      userId,
      saved.id,
      "test@example.net",
      testMode,
      undefined,
      {
        fetch: async (_, init) => {
          assert.equal(
            JSON.parse(String(init?.body)).headers["X-Sib-Sandbox"],
            testMode ? "drop" : undefined,
          );
          return Response.json({
            messageId: testMode ? "sandbox" : "real-test",
          });
        },
      },
    );
    assert(record);
    assert.equal(record.testMode, testMode);
    assert.equal(record.status, "accepted");
    const current = await getConnection(userId, saved.id);
    assert.equal(current.health, testMode ? "UNVERIFIED" : "HEALTHY");
    assert.equal(current.enabled, !testMode);
  }
});
test("transactional Postmark stays excluded after a successful explicit SMTP test", async () => {
  const c = input("postmark", "smtp");
  c.settings.messageStreamType = "transactional";
  c.settings.messageStream = "outbound";
  const deps = {
    smtp: () => ({
      verify: async () => true,
      sendMail: async () => ({
        accepted: ["test@example.net"],
        messageId: "postmark-test",
      }),
      close: () => {},
    }),
  } as unknown as Dependencies;
  const saved = await saveProvider(userId, c, undefined, deps);
  assert(saved);
  assert.equal(saved.health, "CONFIG_ERROR");
  const result = await testProvider(
    userId,
    saved.id,
    "test@example.net",
    false,
    undefined,
    deps,
  );
  assert.equal(result?.status, "accepted");
  const current = await getConnection(userId, saved.id);
  assert.equal(current.enabled, false);
  assert.equal(compatible(current, "sender@example.com"), false);
  assert.equal(
    compatible(
      { ...current, enabled: true, health: "HEALTHY" },
      "sender@example.com",
    ),
    false,
  );
});
