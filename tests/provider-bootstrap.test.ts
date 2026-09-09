import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapProviderTypes,
  buildBootstrapPlan,
  summarizeBootstrapPlan,
} from "../packages/core/src/provider-bootstrap";

const env = {
  PRIMARY_SENDING_DOMAIN: "RahmonTech.COM",
  PRIMARY_FROM_LOCALPART: "Sales",
  PRIMARY_FROM_NAME: "RahmonTech Sales",
  PRIMARY_REPLY_TO: "support@rahmontech.com",
  RESEND_API_KEY: "resend-test-secret",
  MAILGUN_API_KEY: "mailgun-management-test-secret",
  MAILGUN_SENDING_API_KEY: "mailgun-send-test-secret",
  MAILGUN_REGION: "US",
  MAILGUN_SMTP_USERNAME: "mailgun-smtp-user",
  MAILGUN_SMTP_PASSWORD: "mailgun-smtp-test-secret",
  SENDGRID_API_KEY: "sendgrid-test-secret",
  SENDGRID_SMTP_API_KEY: "sendgrid-smtp-test-secret",
  BREVO_API_KEY: "brevo-test-secret",
  BREVO_SMTP_LOGIN: "brevo-smtp-user",
  BREVO_SMTP_KEY: "brevo-smtp-test-secret",
  POSTMARK_SERVER_TOKEN_1: "postmark-one-test-secret",
  POSTMARK_SERVER_TOKEN_2: "postmark-two-test-secret",
  POSTMARK_PRIMARY_SERVER_TOKEN_INDEX: "2",
  MAILJET_API_KEY: "mailjet-key-test-secret",
  MAILJET_SECRET_KEY: "mailjet-secret-test-secret",
  SMTP2GO_API_KEY: "smtp2go-test-secret",
  SMTP2GO_SMTP_USERNAME: "smtp2go-user",
  SMTP2GO_SMTP_PASSWORD: "smtp2go-smtp-test-secret",
  ELASTIC_API_KEY: "elastic-test-secret",
  ELASTIC_SMTP_USERNAME: "elastic-user",
  ELASTIC_SMTP_PASSWORD: "elastic-smtp-test-secret",
};

test("bootstrap builds exactly the eight API connections without exposing secrets", () => {
  const plan = buildBootstrapPlan(env);
  assert.deepEqual(
    plan.connections.map((connection) => connection.type),
    bootstrapProviderTypes,
  );
  assert.equal(plan.domain, "rahmontech.com");
  assert.equal(plan.sender.email, "sales@rahmontech.com");
  assert.equal(plan.connections.length, 8);
  assert(
    plan.connections.every((connection) => connection.transport === "api"),
  );
  assert.equal(
    plan.connections.find((connection) => connection.type === "mailgun")
      ?.credentials.apiKey,
    env.MAILGUN_SENDING_API_KEY,
  );
  assert.equal(
    plan.connections.find((connection) => connection.type === "mailgun")
      ?.credentials.managementApiKey,
    env.MAILGUN_API_KEY,
  );
  assert.equal(
    plan.connections.find((connection) => connection.type === "postmark")
      ?.credentials.serverToken,
    env.POSTMARK_SERVER_TOKEN_2,
  );
  assert.equal(
    plan.connections.find((connection) => connection.type === "brevo")
      ?.credentials.smtpUsername,
    env.BREVO_SMTP_LOGIN,
  );
  assert.notEqual(
    plan.connections.find((connection) => connection.type === "brevo")
      ?.credentials.apiKey,
    env.BREVO_SMTP_KEY,
  );
  const summary = JSON.stringify(summarizeBootstrapPlan(plan));
  for (const [key, value] of Object.entries(env))
    if (
      /(?:API_KEY|SECRET_KEY|SERVER_TOKEN(?:_\d)?|ACCOUNT_TOKEN|PASSWORD)$/.test(
        key,
      )
    )
      assert(!summary.includes(value));
  for (const secret of plan.connections.flatMap((connection) =>
    Object.values(connection.credentials),
  ))
    assert(!summary.includes(secret));
});

test("bootstrap rejects missing secrets and ambiguous Postmark tokens before mutation", () => {
  assert.throws(
    () => buildBootstrapPlan({ ...env, BREVO_API_KEY: "" }),
    /BREVO_API_KEY/,
  );
  const { POSTMARK_PRIMARY_SERVER_TOKEN_INDEX: _, ...ambiguous } = env;
  void _;
  assert.throws(() => buildBootstrapPlan(ambiguous), /POSTMARK_PRIMARY/);
  assert.throws(
    () => buildBootstrapPlan({ ...env, SMTP2GO_SMTP_PASSWORD: "" }),
    /SMTP2GO_SMTP_USERNAME.*SMTP2GO_SMTP_PASSWORD/,
  );
});
