import { z } from "zod";
export const providerTypes = [
  "resend",
  "ses",
  "mailgun",
  "sendgrid",
  "brevo",
  "postmark",
  "mailjet",
  "smtp2go",
  "elastic",
  "smtp",
  "mock",
] as const;
export type ProviderType = (typeof providerTypes)[number];
export const sesRegions = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "af-south-1",
  "ap-east-1",
  "ap-south-1",
  "ap-south-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ca-central-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "il-central-1",
  "me-south-1",
  "me-central-1",
  "sa-east-1",
];
export type SmtpSecurity = "starttls" | "tls";
export type CredentialKey =
  | "apiKey"
  | "managementApiKey"
  | "secretKey"
  | "serverToken"
  | "accountToken"
  | "accessKeyId"
  | "secretAccessKey"
  | "sessionToken"
  | "username"
  | "password";
export interface CredentialField {
  key: CredentialKey;
  label: string;
  helpUrl: string;
  optional?: boolean;
}
export interface SmtpPort {
  port: number;
  security: SmtpSecurity;
}
export interface ProviderDefinition {
  id: ProviderType;
  name: string;
  website: string;
  color: string;
  transports: ("api" | "smtp")[];
  api?: {
    host: string;
    hostsByRegion?: Record<string, string>;
    sendPath: string;
    verifyPath: string;
    streamPath?: string;
    auth:
      | "bearer"
      | "basic-api"
      | "basic"
      | "api-key"
      | "postmark"
      | "smtp2go"
      | "elastic";
  };
  sdk?: {
    name: "SESv2Client";
    auth: "aws-sigv4";
    sendOperation: "SendEmail";
    verifyOperations: ["GetAccount", "GetEmailIdentity"];
  };
  smtp?: {
    host: string;
    hostsByRegion?: Record<string, string>;
    streamHosts?: Record<"broadcast" | "transactional", string>;
    port: number;
    ports: SmtpPort[];
    username?: string;
    usernameField?: CredentialKey;
    passwordField: CredentialKey;
  };
  regions?: string[];
  credentials: {
    api: CredentialField[];
    smtp: CredentialField[];
    smtpServerToken?: CredentialField[];
  };
  verification:
    | "domains"
    | "ses-account"
    | "domain"
    | "scopes"
    | "account-sandbox"
    | "server-stream"
    | "native-sandbox"
    | "read-only"
    | "smtp"
    | "mock";
  capabilities: {
    nativeTestMode: "none" | "format" | "validation";
    idempotency: boolean;
    safeTestRecipient?: string;
  };
  help: string;
  webhook: "svix" | "mailgun" | "sendgrid" | "sns" | "basic" | "none";
}
const ports = (starttls: number[], tls: number[] = []): SmtpPort[] => [
  ...starttls.map((port) => ({ port, security: "starttls" as const })),
  ...tls.map((port) => ({ port, security: "tls" as const })),
];
const field = (
  key: CredentialKey,
  label: string,
  helpUrl: string,
  optional = false,
): CredentialField => ({ key, label, helpUrl, optional });
const smtpFields = (
  helpUrl: string,
  passwordLabel = "SMTP password",
  usernameLabel = "SMTP username",
) => [
  field("username", usernameLabel, helpUrl),
  field("password", passwordLabel, helpUrl),
];
export const catalog: ProviderDefinition[] = [
  {
    id: "resend",
    name: "Resend",
    website: "https://resend.com",
    color: "#171717",
    transports: ["api", "smtp"],
    api: {
      host: "api.resend.com",
      sendPath: "/emails",
      verifyPath: "/domains",
      auth: "bearer",
    },
    smtp: {
      host: "smtp.resend.com",
      port: 465,
      username: "resend",
      ports: ports([25, 587, 2587], [465, 2465]),
      passwordField: "apiKey",
    },
    credentials: {
      api: [
        field(
          "apiKey",
          "API key",
          "https://resend.com/docs/dashboard/api-keys/introduction",
        ),
      ],
      smtp: [
        field(
          "apiKey",
          "API key (SMTP password)",
          "https://resend.com/docs/dashboard/api-keys/introduction",
        ),
      ],
    },
    verification: "domains",
    capabilities: {
      nativeTestMode: "none",
      idempotency: true,
      safeTestRecipient: "delivered@resend.dev",
    },
    help: "Create an API key in Resend → API Keys. Verify your sending domain. Save & Verify never sends email. Use Send Test Email for a controlled test.",
    webhook: "svix",
  },
  {
    id: "ses",
    name: "Amazon SES",
    website: "https://aws.amazon.com/ses",
    color: "#dc7900",
    transports: ["api", "smtp"],
    sdk: {
      name: "SESv2Client",
      auth: "aws-sigv4",
      sendOperation: "SendEmail",
      verifyOperations: ["GetAccount", "GetEmailIdentity"],
    },
    smtp: {
      host: "email-smtp.{region}.amazonaws.com",
      port: 587,
      ports: ports([25, 587, 2587], [465, 2465]),
      usernameField: "username",
      passwordField: "password",
    },
    regions: sesRegions,
    credentials: {
      api: [
        field(
          "accessKeyId",
          "Access Key ID",
          "https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html",
        ),
        field(
          "secretAccessKey",
          "Secret Access Key",
          "https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html",
        ),
        field(
          "sessionToken",
          "Session token (optional)",
          "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_request.html",
          true,
        ),
      ],
      smtp: smtpFields(
        "https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html",
      ),
    },
    verification: "ses-account",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Use an IAM key with SES send, GetAccount and GetEmailIdentity permissions. SMTP uses separate SES SMTP credentials.",
    webhook: "sns",
  },
  {
    id: "mailgun",
    name: "Mailgun",
    website: "https://mailgun.com",
    color: "#cb272f",
    transports: ["api", "smtp"],
    api: {
      host: "api.mailgun.net",
      hostsByRegion: { US: "api.mailgun.net", EU: "api.eu.mailgun.net" },
      sendPath: "/v3/{domain}/messages",
      verifyPath: "/v4/domains/{domain}",
      auth: "basic-api",
    },
    smtp: {
      host: "smtp.mailgun.org",
      hostsByRegion: { US: "smtp.mailgun.org", EU: "smtp.eu.mailgun.org" },
      port: 587,
      ports: ports([25, 2525, 587], [465]),
      usernameField: "username",
      passwordField: "password",
    },
    regions: ["US", "EU"],
    credentials: {
      api: [
        field(
          "apiKey",
          "Sending API key",
          "https://documentation.mailgun.com/docs/mailgun/quickstart",
        ),
        field(
          "managementApiKey",
          "Management API key (optional)",
          "https://documentation.mailgun.com/docs/mailgun/api-reference/openapi-final/tag/Domains/",
          true,
        ),
      ],
      smtp: smtpFields(
        "https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp",
      ),
    },
    verification: "domain",
    capabilities: { nativeTestMode: "validation", idempotency: false },
    help: "API key: Mailgun → API Security. SMTP credentials belong to your sending domain. Test mode may be billable.",
    webhook: "mailgun",
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    website: "https://sendgrid.com",
    color: "#1284bd",
    transports: ["api", "smtp"],
    api: {
      host: "api.sendgrid.com",
      hostsByRegion: { Global: "api.sendgrid.com", EU: "api.eu.sendgrid.com" },
      sendPath: "/v3/mail/send",
      verifyPath: "/v3/scopes",
      auth: "bearer",
    },
    smtp: {
      host: "smtp.sendgrid.net",
      port: 587,
      username: "apikey",
      ports: ports([25, 2525, 587], [465]),
      passwordField: "apiKey",
    },
    regions: ["Global", "EU"],
    credentials: {
      api: [
        field(
          "apiKey",
          "API key",
          "https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys",
        ),
      ],
      smtp: [
        field(
          "apiKey",
          "API key (SMTP password)",
          "https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys",
        ),
      ],
    },
    verification: "scopes",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Settings → API Keys. Grant mail.send. Authenticate the sending domain or verify a Single Sender.",
    webhook: "sendgrid",
  },
  {
    id: "brevo",
    name: "Brevo",
    website: "https://brevo.com",
    color: "#087849",
    transports: ["api", "smtp"],
    api: {
      host: "api.brevo.com",
      sendPath: "/v3/smtp/email",
      verifyPath: "/v3/account",
      auth: "api-key",
    },
    smtp: {
      host: "smtp-relay.brevo.com",
      port: 587,
      ports: ports([587, 2525], [465]),
      usernameField: "username",
      passwordField: "password",
    },
    credentials: {
      api: [
        field(
          "apiKey",
          "API key",
          "https://developers.brevo.com/docs/send-a-transactional-email",
        ),
      ],
      smtp: smtpFields(
        "https://developers.brevo.com/docs/smtp-integration",
        "SMTP key",
        "SMTP login",
      ),
    },
    verification: "account-sandbox",
    capabilities: { nativeTestMode: "format", idempotency: false },
    help: "SMTP & API settings. API mode uses an API key; SMTP requires your SMTP login and SMTP key.",
    webhook: "basic",
  },
  {
    id: "postmark",
    name: "Postmark",
    website: "https://postmarkapp.com",
    color: "#ac7900",
    transports: ["api", "smtp"],
    api: {
      host: "api.postmarkapp.com",
      sendPath: "/email",
      verifyPath: "/server",
      streamPath: "/message-streams/{stream}",
      auth: "postmark",
    },
    smtp: {
      host: "smtp-broadcasts.postmarkapp.com",
      streamHosts: {
        broadcast: "smtp-broadcasts.postmarkapp.com",
        transactional: "smtp.postmarkapp.com",
      },
      port: 587,
      ports: ports([25, 2525, 587], []),
      usernameField: "username",
      passwordField: "password",
    },
    credentials: {
      api: [
        field(
          "serverToken",
          "Server token",
          "https://postmarkapp.com/developer/user-guide/send-email-with-api",
        ),
        field(
          "accountToken",
          "Account token (optional)",
          "https://postmarkapp.com/developer/api/overview",
          true,
        ),
      ],
      smtp: smtpFields(
        "https://postmarkapp.com/developer/user-guide/send-email-with-smtp",
        "Stream SMTP secret key",
        "Stream SMTP access key",
      ),
      smtpServerToken: [
        field(
          "serverToken",
          "Server token",
          "https://postmarkapp.com/developer/user-guide/send-email-with-smtp",
        ),
      ],
    },
    verification: "server-stream",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Server → API Tokens. Select a Broadcast Message Stream. For SMTP use its access key and secret, or server token as both login and password.",
    webhook: "basic",
  },
  {
    id: "mailjet",
    name: "Mailjet",
    website: "https://mailjet.com",
    color: "#bc4b0c",
    transports: ["api", "smtp"],
    api: {
      host: "api.mailjet.com",
      sendPath: "/v3.1/send",
      verifyPath: "/v3.1/send",
      auth: "basic",
    },
    smtp: {
      host: "in-v3.mailjet.com",
      port: 587,
      ports: ports([25, 80, 2525, 587, 588], [465]),
      usernameField: "apiKey",
      passwordField: "secretKey",
    },
    credentials: {
      api: [
        field(
          "apiKey",
          "Public API key",
          "https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-can-I-configure-my-SMTP-parameters",
        ),
        field(
          "secretKey",
          "Secret key",
          "https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-can-I-configure-my-SMTP-parameters",
        ),
      ],
      smtp: [
        field(
          "apiKey",
          "Public API key (SMTP username)",
          "https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-can-I-configure-my-SMTP-parameters",
        ),
        field(
          "secretKey",
          "Secret key (SMTP password)",
          "https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-can-I-configure-my-SMTP-parameters",
        ),
      ],
    },
    verification: "native-sandbox",
    capabilities: { nativeTestMode: "validation", idempotency: false },
    help: "Account → API Key Management. Verify a sender/domain. Save & Verify uses non-delivery Sandbox Mode.",
    webhook: "basic",
  },
  {
    id: "smtp2go",
    name: "SMTP2GO",
    website: "https://smtp2go.com",
    color: "#1655ab",
    transports: ["api", "smtp"],
    api: {
      host: "api.smtp2go.com",
      hostsByRegion: {
        Global: "api.smtp2go.com",
        US: "us-api.smtp2go.com",
        EU: "eu-api.smtp2go.com",
        AU: "au-api.smtp2go.com",
      },
      sendPath: "/v3/email/send",
      verifyPath: "/v3/stats/email_summary",
      auth: "smtp2go",
    },
    smtp: {
      host: "mail.smtp2go.com",
      port: 2525,
      ports: ports([25, 2525, 8025, 587, 80], [465, 8465, 443]),
      usernameField: "username",
      passwordField: "password",
    },
    regions: ["Global", "US", "EU", "AU"],
    credentials: {
      api: [
        field(
          "apiKey",
          "API key",
          "https://developers.smtp2go.com/reference/general-api-resources",
        ),
      ],
      smtp: smtpFields("https://www.smtp2go.com/setupguide/"),
    },
    verification: "read-only",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Sending → API Keys or SMTP Users. Add a Verified Sender. Read-only checks may require an explicit test send.",
    webhook: "basic",
  },
  {
    id: "elastic",
    name: "Elastic Email",
    website: "https://elasticemail.com",
    color: "#1d6999",
    transports: ["api", "smtp"],
    api: {
      host: "api.elasticemail.com",
      sendPath: "/v4/emails/transactional",
      verifyPath: "/v4/domains",
      auth: "elastic",
    },
    smtp: {
      host: "smtp.elasticemail.com",
      port: 587,
      ports: ports([25, 2525, 587], [465]),
      usernameField: "username",
      passwordField: "password",
    },
    credentials: {
      api: [
        field(
          "apiKey",
          "API key (SendHttp)",
          "https://help.elasticemail.com/en/articles/4799160-api-settings",
        ),
      ],
      smtp: smtpFields(
        "https://help.elasticemail.com/en/articles/4803409-smtp-settings",
      ),
    },
    verification: "read-only",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Settings → API or SMTP. API keys need SendHttp permission; domain reads use a separate permission.",
    webhook: "basic",
  },
  {
    id: "smtp",
    name: "Custom SMTP",
    website: "",
    color: "#5d597d",
    transports: ["smtp"],
    credentials: { api: [], smtp: smtpFields("") },
    verification: "smtp",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Use your mail service’s SMTP host and credentials. Public hosts with validated TLS certificates only.",
    webhook: "none",
  },
  {
    id: "mock",
    name: "Development Mock",
    website: "",
    color: "#555",
    transports: ["api"],
    credentials: { api: [], smtp: [] },
    verification: "mock",
    capabilities: { nativeTestMode: "none", idempotency: false },
    help: "Local simulation only. No email leaves this adapter.",
    webhook: "basic",
  },
];
export function definition(type: ProviderType) {
  return catalog.find((p) => p.id === type)!;
}
export const headerText = z
  .string()
  .trim()
  .max(200)
  .refine((v) => !/[\r\n]/.test(v), "Line breaks are not allowed");
export const settingsSchema = z
  .object({
    fromEmail: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((v) => v.toLowerCase()),
    fromName: headerText.default(""),
    replyTo: z
      .string()
      .trim()
      .pipe(z.union([z.email(), z.literal("")]))
      .transform((v) => v.toLowerCase())
      .default(""),
    region: z.string().max(40).optional(),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/)
      .optional(),
    messageStreamType: z.enum(["broadcast", "transactional"]).optional(),
    postmarkCredentialMode: z.enum(["smtp_token", "server_token"]).optional(),
    messageStream: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,60}$/)
      .default("broadcast"),
    host: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/)
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
    security: z.enum(["starttls", "tls"]).optional(),
    timeout: z.number().int().min(5000).max(60000).default(20000),
    mockMode: z
      .enum([
        "success",
        "delay",
        "temporary",
        "permanent",
        "rate_limit",
        "unknown",
        "bounce",
      ])
      .default("success"),
  })
  .strict();
export const connectionSchema = z
  .object({
    name: headerText.min(1),
    type: z.enum(providerTypes),
    transport: z.enum(["api", "smtp"]),
    settings: settingsSchema,
    credentials: z.record(
      z.string(),
      z
        .string()
        .max(8192)
        .refine(
          (v) => !/[\r\n\0]/.test(v),
          "Credential contains control characters",
        ),
    ),
    weight: z.number().int().min(1).max(100).default(1),
    perSecond: z.number().int().min(1).max(100).default(1),
    perMinute: z.number().int().min(1).max(6000).default(30),
    concurrency: z.number().int().min(1).max(20).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    const d = definition(v.type);
    const fail = (path: string[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (!d.transports.includes(v.transport))
      fail(["transport"], "Transport not supported");
    if (d.regions && !d.regions.includes(v.settings.region ?? d.regions[0]))
      fail(["settings", "region"], "Select a supported region");
    if (v.type === "mailgun" && !v.settings.domain)
      fail(["settings", "domain"], "Mailgun requires a sending domain");
    if (v.type === "smtp" && !v.settings.host)
      fail(["settings", "host"], "SMTP hostname required");
    if (v.type !== "smtp" && v.settings.host)
      fail(["settings", "host"], "Built-in endpoints cannot be overridden");
    if (
      v.transport === "smtp" &&
      d.smtp &&
      v.settings.port &&
      !d.smtp.ports.some((p) => p.port === v.settings.port)
    )
      fail(["settings", "port"], "Unsupported SMTP port");
    if (v.transport === "smtp" && d.smtp && v.settings.security) {
      const preset = d.smtp.ports.find(
        (p) => p.port === (v.settings.port ?? d.smtp!.port),
      );
      if (preset && v.settings.security !== preset.security)
        fail(
          ["settings", "security"],
          "Use the catalog TLS setting for this SMTP port",
        );
    }
    if (
      v.type !== "postmark" &&
      (v.settings.messageStreamType || v.settings.postmarkCredentialMode)
    )
      fail(["settings"], "Postmark settings are only supported for Postmark");
    for (const f of credentialFields(v.type, v.transport, v.settings))
      if (!f.optional && !v.credentials[f.key]?.trim())
        fail(["credentials", f.key], "Credential required");
  });
export type ConnectionInput = z.infer<typeof connectionSchema>;
export type Connection = ConnectionInput & { id: string };
export function credentialFields(
  type: ProviderType,
  transport: "api" | "smtp",
  settings: { postmarkCredentialMode?: string } = {},
): CredentialField[] {
  const d = definition(type);
  return transport === "smtp" &&
    settings.postmarkCredentialMode === "server_token"
    ? (d.credentials.smtpServerToken ?? d.credentials.smtp)
    : d.credentials[transport];
}
export function supportsTestMode(c: Pick<Connection, "type" | "transport">) {
  return (
    c.transport === "api" &&
    definition(c.type).capabilities.nativeTestMode !== "none"
  );
}
export function smtpCredentials(c: Connection) {
  if (
    c.type === "postmark" &&
    c.settings.postmarkCredentialMode === "server_token"
  )
    return { user: c.credentials.serverToken, pass: c.credentials.serverToken };
  const preset = definition(c.type).smtp;
  return {
    user:
      preset?.username ?? c.credentials[preset?.usernameField ?? "username"],
    pass: c.credentials[preset?.passwordField ?? "password"],
  };
}
export function endpoints(c: Pick<Connection, "type" | "settings">) {
  const d = definition(c.type);
  const region = c.settings.region ?? d.regions?.[0] ?? "";
  const apiHost = d.api?.hostsByRegion?.[region] ?? d.api?.host;
  const smtpHost = (
    d.smtp?.streamHosts?.[c.settings.messageStreamType ?? "broadcast"] ??
    d.smtp?.hostsByRegion?.[region] ??
    d.smtp?.host ??
    c.settings.host
  )?.replace("{region}", region);
  const path = (s?: string) =>
    s
      ?.replace("{domain}", encodeURIComponent(c.settings.domain ?? ""))
      .replace("{stream}", encodeURIComponent(c.settings.messageStream));
  const port = c.settings.port ?? d.smtp?.port ?? 587;
  const security = d.smtp
    ? d.smtp.ports.find((p) => p.port === port)?.security
    : (c.settings.security ?? (port === 465 ? "tls" : "starttls"));
  return {
    apiBaseUrl: apiHost ? `https://${apiHost}` : undefined,
    sendUrl: apiHost ? `https://${apiHost}${path(d.api!.sendPath)}` : undefined,
    verifyUrl: apiHost
      ? `https://${apiHost}${path(d.api!.verifyPath)}`
      : undefined,
    streamUrl:
      apiHost && d.api?.streamPath
        ? `https://${apiHost}${path(d.api.streamPath)}`
        : undefined,
    smtpHost,
    port,
    security,
  };
}
