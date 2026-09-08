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
export interface ProviderDefinition {
  id: ProviderType;
  name: string;
  website: string;
  color: string;
  transports: ("api" | "smtp")[];
  api?: { host: string; sendPath: string; verifyPath: string; auth: string };
  smtp?: { host: string; port: number; username?: string; ports: number[] };
  regions?: string[];
  apiFields: string[];
  help: string;
  webhook: "svix" | "mailgun" | "sendgrid" | "sns" | "basic" | "none";
}
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
      ports: [465, 2465, 25, 587, 2587],
    },
    apiFields: ["apiKey"],
    help: "Create an API key in Resend → API Keys. Verify your sending domain. Safe verification emails count toward quota.",
    webhook: "svix",
  },
  {
    id: "ses",
    name: "Amazon SES",
    website: "https://aws.amazon.com/ses",
    color: "#dc7900",
    transports: ["api", "smtp"],
    smtp: {
      host: "email-smtp.{region}.amazonaws.com",
      port: 587,
      ports: [25, 587, 2587, 465, 2465],
    },
    regions: sesRegions,
    apiFields: ["accessKeyId", "secretAccessKey", "sessionToken?"],
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
      sendPath: "/v3/{domain}/messages",
      verifyPath: "/v4/domains/{domain}",
      auth: "basic-api",
    },
    smtp: { host: "smtp.mailgun.org", port: 587, ports: [25, 2525, 587, 465] },
    regions: ["US", "EU"],
    apiFields: ["apiKey"],
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
      sendPath: "/v3/mail/send",
      verifyPath: "/v3/scopes",
      auth: "bearer",
    },
    smtp: {
      host: "smtp.sendgrid.net",
      port: 587,
      username: "apikey",
      ports: [25, 2525, 587, 465],
    },
    regions: ["Global", "EU"],
    apiFields: ["apiKey"],
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
    smtp: { host: "smtp-relay.brevo.com", port: 587, ports: [587, 2525, 465] },
    apiFields: ["apiKey"],
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
      auth: "postmark",
    },
    smtp: {
      host: "smtp-broadcasts.postmarkapp.com",
      port: 587,
      ports: [25, 2525, 587],
    },
    apiFields: ["serverToken"],
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
    smtp: { host: "in-v3.mailjet.com", port: 587, ports: [587, 465] },
    apiFields: ["apiKey", "secretKey"],
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
      sendPath: "/v3/email/send",
      verifyPath: "/v3/stats/email_summary",
      auth: "smtp2go",
    },
    smtp: {
      host: "mail.smtp2go.com",
      port: 2525,
      ports: [25, 2525, 8025, 587, 80, 465, 8465, 443],
    },
    regions: ["Global", "US", "EU", "AU"],
    apiFields: ["apiKey"],
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
      ports: [25, 2525, 587, 465],
    },
    apiFields: ["apiKey"],
    help: "Settings → API or SMTP. API keys need SendHttp permission; domain reads use a separate permission.",
    webhook: "basic",
  },
  {
    id: "smtp",
    name: "Custom SMTP",
    website: "",
    color: "#5d597d",
    transports: ["smtp"],
    apiFields: [],
    help: "Use your mail service’s SMTP host and credentials. Public hosts with validated TLS certificates only.",
    webhook: "none",
  },
  {
    id: "mock",
    name: "Development Mock",
    website: "",
    color: "#555",
    transports: ["api"],
    apiFields: [],
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
    fromEmail: z.email().transform((v) => v.toLowerCase()),
    fromName: headerText.default(""),
    replyTo: z.union([z.email(), z.literal("")]).default(""),
    region: z.string().max(40).optional(),
    domain: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/)
      .optional(),
    messageStream: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,60}$/)
      .default("broadcast"),
    host: z.string().max(253).optional(),
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
    credentials: z.record(z.string(), z.string().max(8192)),
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
      !d.smtp.ports.includes(v.settings.port)
    )
      fail(["settings", "port"], "Unsupported SMTP port");
    const fields =
      v.transport === "api"
        ? d.apiFields
        : ["resend", "sendgrid"].includes(v.type)
          ? ["apiKey"]
          : v.type === "mailjet"
            ? ["apiKey", "secretKey"]
            : ["username", "password"];
    for (const f of fields)
      if (!f.endsWith("?") && !v.credentials[f]?.trim())
        fail(["credentials", f], "Credential required");
  });
export type ConnectionInput = z.infer<typeof connectionSchema>;
export type Connection = ConnectionInput & { id: string };
export function endpoints(c: Pick<Connection, "type" | "settings">) {
  const d = definition(c.type);
  const region = c.settings.region ?? d.regions?.[0] ?? "";
  let apiHost = d.api?.host;
  let smtpHost = d.smtp?.host ?? c.settings.host;
  if (c.type === "mailgun" && region === "EU") {
    apiHost = "api.eu.mailgun.net";
    smtpHost = "smtp.eu.mailgun.org";
  }
  if (c.type === "sendgrid" && region === "EU") apiHost = "api.eu.sendgrid.com";
  if (c.type === "smtp2go" && region !== "Global")
    apiHost = `${region.toLowerCase()}-api.smtp2go.com`;
  if (c.type === "ses") smtpHost = `email-smtp.${region}.amazonaws.com`;
  const path = (s?: string) =>
    s?.replace("{domain}", encodeURIComponent(c.settings.domain ?? ""));
  return {
    sendUrl: apiHost ? `https://${apiHost}${path(d.api!.sendPath)}` : undefined,
    verifyUrl: apiHost
      ? `https://${apiHost}${path(d.api!.verifyPath)}`
      : undefined,
    smtpHost,
    port: c.settings.port ?? d.smtp?.port ?? 587,
  };
}
