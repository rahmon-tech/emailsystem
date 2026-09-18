import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  catalog,
  definition,
  endpoints,
  connectionSchema,
  credentialFields,
} from "../packages/providers/src/catalog";
import {
  buildRequest,
  buildSmtpOptions,
  send,
  verifyConnection,
} from "../packages/providers/src/index";
import type {
  Dependencies,
  ProviderMessage,
} from "../packages/providers/src/index";
import { connection } from "./fixtures";

const message: ProviderMessage = {
  from: "sender@example.com",
  fromName: "Sender",
  to: "test@example.net",
  cc: [],
  bcc: [],
  replyTo: "",
  subject: "Controlled test",
  html: "<p>Test</p>",
  text: "Test",
  headers: {},
  attachments: [],
};
const apiCases = [
  [
    "resend",
    "https://api.resend.com/emails",
    "Authorization",
    "Bearer key-secret",
  ],
  [
    "mailgun",
    "https://api.mailgun.net/v3/example.com/messages",
    "Authorization",
    "Basic YXBpOmtleS1zZWNyZXQ=",
  ],
  [
    "sendgrid",
    "https://api.sendgrid.com/v3/mail/send",
    "Authorization",
    "Bearer key-secret",
  ],
  ["brevo", "https://api.brevo.com/v3/smtp/email", "api-key", "key-secret"],
  [
    "postmark",
    "https://api.postmarkapp.com/email",
    "X-Postmark-Server-Token",
    "token-secret",
  ],
  [
    "mailjet",
    "https://api.mailjet.com/v3.1/send",
    "Authorization",
    "Basic a2V5LXNlY3JldDpzZWNyZXQtc2VjcmV0",
  ],
  [
    "smtp2go",
    "https://api.smtp2go.com/v3/email/send",
    "X-Smtp2go-Api-Key",
    "key-secret",
  ],
  [
    "elastic",
    "https://api.elasticemail.com/v4/emails/transactional",
    "X-ElasticEmail-ApiKey",
    "key-secret",
  ],
] as const;
for (const [type, url, header, value] of apiCases) {
  test(type + ": exact HTTP send URL and authentication contract", () => {
    const c = connection(type);
    const req = buildRequest(c, message, {
      attemptId: "attempt",
      idempotencyKey: "key",
    });
    assert.equal(req.url, url);
    assert.equal(req.method, "POST");
    assert.equal(new Headers(req.headers).get(header), value);
    assert.equal(endpoints(c).apiBaseUrl, new URL(url).origin);
    if (type === "postmark") {
      assert.equal(req.headers.Accept, "application/json");
      assert.equal(JSON.parse(String(req.body)).MessageStream, "broadcast");
    }
  });
}
const smtpCases = [
  [
    "resend",
    "smtp.resend.com",
    465,
    "resend",
    "key-secret",
    [25, 587, 2587],
    [465, 2465],
  ],
  [
    "ses",
    "email-smtp.us-east-1.amazonaws.com",
    587,
    "smtp-user",
    "smtp-secret",
    [25, 587, 2587],
    [465, 2465],
  ],
  [
    "mailgun",
    "smtp.mailgun.org",
    587,
    "smtp-user",
    "smtp-secret",
    [25, 2525, 587],
    [465],
  ],
  [
    "sendgrid",
    "smtp.sendgrid.net",
    587,
    "apikey",
    "key-secret",
    [25, 2525, 587],
    [465],
  ],
  [
    "brevo",
    "smtp-relay.brevo.com",
    587,
    "smtp-user",
    "smtp-secret",
    [587, 2525],
    [465],
  ],
  [
    "postmark",
    "smtp-broadcasts.postmarkapp.com",
    587,
    "smtp-user",
    "smtp-secret",
    [25, 2525, 587],
    [],
  ],
  [
    "mailjet",
    "in-v3.mailjet.com",
    587,
    "key-secret",
    "secret-secret",
    [25, 80, 2525, 587, 588],
    [465],
  ],
  [
    "smtp2go",
    "mail.smtp2go.com",
    2525,
    "smtp-user",
    "smtp-secret",
    [25, 2525, 8025, 587, 80],
    [465, 8465, 443],
  ],
  [
    "elastic",
    "smtp.elasticemail.com",
    587,
    "smtp-user",
    "smtp-secret",
    [25, 2525, 587],
    [465],
  ],
] as const;
for (const [type, host, port, user, pass, starttls, tls] of smtpCases) {
  test(
    type +
      ": exact SMTP preset, credential mapping and every supported TLS pair",
    async () => {
      const c = { ...connection(type), transport: "smtp" as const };
      assert.equal(endpoints(c).smtpHost, host);
      assert.equal(endpoints(c).port, port);
      assert.deepEqual(buildSmtpOptions(c, "203.0.113.10").auth, {
        user,
        pass,
      });
      assert.deepEqual(definition(type).smtp!.ports, [
        ...starttls.map((port) => ({ port, security: "starttls" })),
        ...tls.map((port) => ({ port, security: "tls" })),
      ]);
      for (const [ports, security] of [
        [starttls, "starttls"],
        [tls, "tls"],
      ] as const)
        for (const selected of ports) {
          c.settings.port = selected;
          const options = buildSmtpOptions(c, "203.0.113.10");
          assert.equal(options.secure, security === "tls");
          assert.equal(options.requireTLS, security !== "tls");
          assert.equal(options.tls?.rejectUnauthorized, true);
          const { id, ...input } = c;
          assert(id);
          assert(
            connectionSchema.safeParse({
              ...input,
              settings: { ...c.settings, security },
            }).success,
          );
          assert(
            !connectionSchema.safeParse({
              ...input,
              settings: {
                ...c.settings,
                security: security === "tls" ? "starttls" : "tls",
              },
            }).success,
          );
        }
      let sends = 0,
        verifies = 0;
      await verifyConnection(c, {
        smtp: () => ({
          verify: async () => {
            verifies++;
            return true;
          },
          sendMail: async () => {
            sends++;
            throw Error("Verification must never send");
          },
          close: () => {},
        }),
      } as unknown as Dependencies);
      assert.equal(verifies, 1);
      assert.equal(sends, 0);
    },
  );
}
test("regional API and SMTP routing uses exact documented hosts", () => {
  for (const [type, region, api, smtp] of [
    [
      "mailgun",
      "EU",
      "https://api.eu.mailgun.net/v3/example.com/messages",
      "smtp.eu.mailgun.org",
    ],
    [
      "sendgrid",
      "EU",
      "https://api.eu.sendgrid.com/v3/mail/send",
      "smtp.sendgrid.net",
    ],
    [
      "smtp2go",
      "US",
      "https://us-api.smtp2go.com/v3/email/send",
      "mail.smtp2go.com",
    ],
    [
      "smtp2go",
      "EU",
      "https://eu-api.smtp2go.com/v3/email/send",
      "mail.smtp2go.com",
    ],
    [
      "smtp2go",
      "AU",
      "https://au-api.smtp2go.com/v3/email/send",
      "mail.smtp2go.com",
    ],
  ] as const) {
    const c = connection(type);
    c.settings.region = region;
    assert.equal(endpoints(c).sendUrl, api);
    assert.equal(endpoints(c).smtpHost, smtp);
  }
  for (const region of [
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "eu-west-1",
    "eu-west-2",
    "eu-central-1",
    "ap-south-1",
    "ap-southeast-1",
    "ap-southeast-2",
  ]) {
    const c = connection("ses");
    c.settings.region = region;
    assert.equal(
      endpoints(c).smtpHost,
      "email-smtp." + region + ".amazonaws.com",
    );
    assert.equal(endpoints(c).sendUrl, undefined);
  }
  assert.deepEqual(definition("ses").sdk, {
    name: "SESv2Client",
    auth: "aws-sigv4",
    sendOperation: "SendEmail",
    verifyOperations: ["GetAccount", "GetEmailIdentity"],
  });
});
test("Postmark selects both SMTP hosts and both explicit credential modes", async () => {
  for (const messageStreamType of ["broadcast", "transactional"] as const)
    for (const postmarkCredentialMode of [
      "smtp_token",
      "server_token",
    ] as const) {
      const c = { ...connection("postmark"), transport: "smtp" as const };
      Object.assign(c.settings, {
        messageStreamType,
        postmarkCredentialMode,
        messageStream:
          messageStreamType === "broadcast" ? "newsletter" : "outbound",
      });
      assert.equal(
        endpoints(c).smtpHost,
        messageStreamType === "broadcast"
          ? "smtp-broadcasts.postmarkapp.com"
          : "smtp.postmarkapp.com",
      );
      assert.deepEqual(
        buildSmtpOptions(c, "203.0.113.10").auth,
        postmarkCredentialMode === "server_token"
          ? { user: "token-secret", pass: "token-secret" }
          : { user: "smtp-user", pass: "smtp-secret" },
      );
      assert.deepEqual(
        credentialFields("postmark", "smtp", c.settings).map((f) => f.key),
        postmarkCredentialMode === "server_token"
          ? ["serverToken"]
          : ["username", "password"],
      );
      let stream: unknown;
      await send(c, message, { attemptId: "a", idempotencyKey: "i" }, {
        smtp: () => ({
          sendMail: async (options: { headers: Record<string, string> }) => {
            stream = options.headers["X-PM-Message-Stream"];
            return { accepted: [message.to], messageId: "smtp-id" };
          },
          close: () => {},
        }),
      } as unknown as Dependencies);
      assert.equal(stream, c.settings.messageStream);
    }
});
test("custom SMTP normalizes input and honors timeout, port, security and credentials", () => {
  const c = connectionSchema.parse({
    name: " Custom ",
    type: "smtp",
    transport: "smtp",
    settings: {
      fromEmail: " Sender@Example.com ",
      host: " SMTP.Example.com ",
      port: 2465,
      security: "tls",
      timeout: 45000,
    },
    credentials: { username: "custom-user", password: "custom-password" },
  });
  assert.equal(c.name, "Custom");
  assert.equal(c.settings.fromEmail, "sender@example.com");
  const options = buildSmtpOptions({ ...c, id: "custom" }, "203.0.113.10");
  assert.equal(options.tls?.servername, "smtp.example.com");
  assert.equal(options.port, 2465);
  assert.equal(options.secure, true);
  assert.equal(options.connectionTimeout, 45000);
  assert.deepEqual(options.auth, {
    user: "custom-user",
    pass: "custom-password",
  });
});
test("catalog schemas reject endpoint injection, unsupported regions and malformed credentials", () => {
  for (const def of catalog.filter((p) => p.website)) {
    const { id, ...input } = connection(def.id);
    assert(id);
    for (const injected of [
      { host: "attacker.example" },
      { apiBaseUrl: "https://attacker.example" },
      { sendPath: "/other" },
      { region: "invalid-region" },
    ]) {
      if ("region" in injected && !def.regions) continue;
      assert(
        !connectionSchema.safeParse({
          ...input,
          settings: { ...input.settings, ...injected },
        }).success,
      );
    }
    for (const f of credentialFields(def.id, "api")) {
      assert.match(f.helpUrl, /^https:\/\//);
      if (!f.optional) {
        const credentials = { ...input.credentials };
        delete credentials[f.key];
        assert(!connectionSchema.safeParse({ ...input, credentials }).success);
      }
    }
    assert(
      !connectionSchema.safeParse({
        ...input,
        credentials: {
          ...input.credentials,
          apiKey: "key\r\nInjected: secret",
        },
      }).success,
    );
  }
});
test("unsupported native test mode rejects before any SMTP, SDK or HTTP action", async () => {
  for (const type of [
    "resend",
    "ses",
    "sendgrid",
    "postmark",
    "smtp2go",
    "elastic",
    "smtp",
  ] as const) {
    let called = false;
    const trip = async () => {
      called = true;
      throw Error("Network must not run");
    };
    const result = await send(
      connection(type),
      message,
      { attemptId: "a", idempotencyKey: "i", testMode: true },
      {
        fetch: trip,
        ses: { send: trip },
        smtp: () => {
          called = true;
          throw Error("SMTP must not run");
        },
      },
    );
    assert.equal(result.status, "rejected");
    assert.equal(called, false);
  }
});
test("explicit Resend test sends use the safe address and separate idempotency keys", async () => {
  const keys = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    const result = await send(
      connection("resend"),
      { ...message, to: definition("resend").capabilities.safeTestRecipient! },
      { attemptId: id, idempotencyKey: id },
      {
        fetch: async (url, init) => {
          assert.equal(url, "https://api.resend.com/emails");
          assert.deepEqual(JSON.parse(String(init?.body)).to, [
            "delivered@resend.dev",
          ]);
          keys.add(new Headers(init?.headers).get("Idempotency-Key")!);
          return Response.json({ id: "test-" + i });
        },
      },
    );
    assert.equal(result.status, "accepted");
  }
  assert.equal(keys.size, 2);
});


test("connection schema accepts bounded domain aliases and daily/monthly caps", () => {
  const parsed = connectionSchema.parse({
    name: "Domain pool",
    type: "smtp",
    transport: "smtp",
    settings: {
      fromEmail: "info@example.com",
      senderDomain: "Example.COM",
      senderAliases: ["info", "support", "hello"],
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
    },
    credentials: { username: "user", password: "secret" },
    dailyBudget: 5000,
    monthlyBudget: 120000,
  });
  assert.equal(parsed.settings.senderDomain, "example.com");
  assert.deepEqual(parsed.settings.senderAliases, ["info", "support", "hello"]);
  assert.equal(parsed.dailyBudget, 5000);
  assert.equal(parsed.monthlyBudget, 120000);

  assert(
    !connectionSchema.safeParse({
      ...parsed,
      settings: {
        ...parsed.settings,
        senderAliases: Array.from({ length: 11 }, (_, index) => `alias-${index}`),
      },
    }).success,
  );
  assert(
    !connectionSchema.safeParse({ ...parsed, monthlyBudget: 0 }).success,
  );
});
