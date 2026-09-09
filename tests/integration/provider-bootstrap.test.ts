import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser } from "@emailsystem/core/auth";
import {
  applyBootstrapPlan,
  buildBootstrapPlan,
  verifyBootstrapProviders,
} from "@emailsystem/core/provider-bootstrap";
import { listSenders } from "@emailsystem/core/senders";
import { unlocked } from "@emailsystem/core/providers";

const owners: string[] = [];
after(async () => {
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
  await redis.quit();
});

const environment = {
  PRIMARY_SENDING_DOMAIN: "Example.COM",
  PRIMARY_FROM_LOCALPART: "News",
  PRIMARY_FROM_NAME: "Example News",
  PRIMARY_REPLY_TO: "reply@example.com",
  RESEND_API_KEY: "synthetic-resend-secret",
  MAILGUN_API_KEY: "synthetic-mailgun-management",
  MAILGUN_SENDING_API_KEY: "synthetic-mailgun-sending",
  MAILGUN_SMTP_USERNAME: "synthetic-mailgun-user",
  MAILGUN_SMTP_PASSWORD: "synthetic-mailgun-smtp",
  MAILGUN_REGION: "US",
  SENDGRID_API_KEY: "synthetic-sendgrid-api",
  SENDGRID_SMTP_API_KEY: "synthetic-sendgrid-smtp",
  BREVO_API_KEY: "synthetic-brevo-api",
  BREVO_SMTP_LOGIN: "synthetic-brevo-user",
  BREVO_SMTP_KEY: "synthetic-brevo-smtp",
  POSTMARK_SERVER_TOKEN_1: "synthetic-postmark-one",
  POSTMARK_SERVER_TOKEN_2: "synthetic-postmark-two",
  POSTMARK_PRIMARY_SERVER_TOKEN_INDEX: "1",
  POSTMARK_ACCOUNT_TOKEN: "synthetic-postmark-account",
  MAILJET_API_KEY: "synthetic-mailjet-api",
  MAILJET_SECRET_KEY: "synthetic-mailjet-secret",
  SMTP2GO_API_KEY: "synthetic-smtp2go-api",
  SMTP2GO_SMTP_USERNAME: "synthetic-smtp2go-user",
  SMTP2GO_SMTP_PASSWORD: "synthetic-smtp2go-smtp",
  ELASTIC_API_KEY: "synthetic-elastic-api",
  ELASTIC_SMTP_USERNAME: "synthetic-elastic-user",
  ELASTIC_SMTP_PASSWORD: "synthetic-elastic-smtp",
};

test("eight-provider bootstrap is idempotent and encrypts API and backup SMTP fields", async () => {
  const user = await createUser(
    `bootstrap-${crypto.randomUUID()}@example.net`,
    "Isolated bootstrap password 2026",
  );
  owners.push(user.id);
  const plan = buildBootstrapPlan(environment);
  const first = await applyBootstrapPlan(user.id, plan);
  const second = await applyBootstrapPlan(user.id, plan);
  assert.equal(first.providers.length, 8);
  assert.deepEqual(
    first.providers.map((provider) => provider.id),
    second.providers.map((provider) => provider.id),
  );
  const rows = await db.providerConnection.findMany({
    where: { userId: user.id },
    orderBy: { bootstrapKey: "asc" },
  });
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.enabled, false);
    assert.equal(row.health, "UNVERIFIED");
    const serialized = JSON.stringify(row.credentials);
    for (const value of Object.values(environment))
      if (value.startsWith("synthetic-")) assert(!serialized.includes(value));
  }
  const mailgun = rows.find((row) => row.bootstrapKey === "mailgun")!;
  assert.deepEqual(unlocked(mailgun).credentials, {
    apiKey: environment.MAILGUN_SENDING_API_KEY,
    managementApiKey: environment.MAILGUN_API_KEY,
    smtpUsername: environment.MAILGUN_SMTP_USERNAME,
    smtpPassword: environment.MAILGUN_SMTP_PASSWORD,
  });
  const senders = await listSenders(user.id);
  assert.equal(senders.domains.length, 1);
  assert.equal(senders.domains[0].senders[0].email, "news@example.com");
  assert.equal(senders.domains[0].providers.length, 8);
  assert.equal(senders.domains[0].status, "UNVERIFIED");
});

test("bootstrap verification uses only read or provider-native non-delivery checks", async () => {
  const user = await createUser(
    `bootstrap-verify-${crypto.randomUUID()}@example.net`,
    "Isolated bootstrap verification password 2026",
  );
  owners.push(user.id);
  const plan = buildBootstrapPlan(environment);
  await applyBootstrapPlan(user.id, plan);
  const operations: string[] = [];
  const results = await verifyBootstrapProviders(user.id, plan, {
    fetch: async (url, init) => {
      const target = String(url);
      const method = init?.method ?? "GET";
      operations.push(
        `${method} ${new URL(target).hostname}${new URL(target).pathname}`,
      );
      if (target.includes("api.resend.com/domains"))
        return Response.json({
          data: [{ name: "example.com", status: "verified" }],
        });
      if (target.includes("api.mailgun.net/v4/domains/"))
        return Response.json({
          domain: { name: "example.com", state: "active" },
        });
      if (target.includes("sendgrid.com/v3/scopes"))
        return Response.json({ scopes: ["mail.send"] });
      if (target.includes("api.brevo.com/v3/account"))
        return Response.json({ relay: { enabled: true } });
      if (target.includes("api.brevo.com/v3/smtp/email")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.headers["X-Sib-Sandbox"], "drop");
        return Response.json({ messageId: "synthetic-sandbox" });
      }
      if (target.endsWith("api.postmarkapp.com/server"))
        return Response.json({
          ID: 42,
          Name: "Synthetic",
          DeliveryType: "Live",
        });
      if (target.includes("api.postmarkapp.com/message-streams/"))
        return Response.json({ MessageStreamType: "Broadcast" });
      if (target.includes("api.mailjet.com/v3.1/send")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.SandboxMode, true);
        return Response.json({ Messages: [{ Status: "success" }] });
      }
      if (target.includes("api.smtp2go.com/v3/stats/email_summary"))
        return Response.json({ data: { delivered: 0 } });
      if (target.includes("api.elasticemail.com/v4/domains"))
        return Response.json([]);
      return Response.json({}, { status: 404 });
    },
  });
  assert.equal(results.length, 8);
  assert(results.every((result) => result.deliveryPerformed === false));
  assert(!operations.some((operation) => operation.includes("/emails")));
  assert(!operations.some((operation) => operation.includes("/mail/send")));
  assert(!operations.some((operation) => operation.includes("/email/send")));
  const senders = await listSenders(user.id);
  assert.equal(senders.domains[0].status, "VERIFIED");
  assert.equal(senders.domains[0].senders[0].availableProviderIds.length, 3);
});
