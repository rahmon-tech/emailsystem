import { z } from "zod";
import {
  connectionSchema,
  type ConnectionInput,
  type Dependencies,
  type ProviderType,
  verifyConnection,
} from "@emailsystem/providers";
import { db } from "@emailsystem/db";
import { canonicalDomain } from "./reputation";
import { canonicalLocalPart, senderEmail } from "./senders";
import { upsertBootstrapProvider, verifyProvider } from "./providers";

export const bootstrapProviderTypes = [
  "resend",
  "mailgun",
  "sendgrid",
  "brevo",
  "postmark",
  "mailjet",
  "smtp2go",
  "elastic",
] as const satisfies readonly ProviderType[];

export type BootstrapProviderType = (typeof bootstrapProviderTypes)[number];

export type BootstrapConnection = ConnectionInput & {
  type: BootstrapProviderType;
  bootstrapKey: BootstrapProviderType;
};

export interface BootstrapPlan {
  domain: string;
  sender: {
    localPart: string;
    email: string;
    displayName: string;
    replyTo: string;
  };
  connections: BootstrapConnection[];
}

type Environment = Record<string, string | undefined>;

function required(environment: Environment, key: string) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required.`);
  if (/[\r\n\0]/.test(value)) throw new Error(`${key} is invalid.`);
  return value;
}

function optional(environment: Environment, key: string) {
  const value = environment[key]?.trim() ?? "";
  if (/[\r\n\0]/.test(value)) throw new Error(`${key} is invalid.`);
  return value;
}

function optionalPair(
  environment: Environment,
  usernameKey: string,
  passwordKey: string,
): Record<string, string> {
  const username = optional(environment, usernameKey);
  const password = optional(environment, passwordKey);
  if (!!username !== !!password)
    throw new Error(
      `${usernameKey} and ${passwordKey} must be supplied together.`,
    );
  return username ? { smtpUsername: username, smtpPassword: password } : {};
}

function oneOf<T extends string>(
  environment: Environment,
  key: string,
  values: readonly T[],
  fallback: T,
) {
  const value = (environment[key]?.trim() || fallback) as T;
  if (!values.includes(value))
    throw new Error(`${key} must be one of: ${values.join(", ")}.`);
  return value;
}

function postmarkServerToken(environment: Environment) {
  const first = optional(environment, "POSTMARK_SERVER_TOKEN_1");
  const second = optional(environment, "POSTMARK_SERVER_TOKEN_2");
  const legacy = optional(environment, "POSTMARK_SERVER_TOKEN");
  const candidates = [first, second, legacy].filter(Boolean);
  if (!candidates.length)
    throw new Error(
      "POSTMARK_SERVER_TOKEN_1, POSTMARK_SERVER_TOKEN_2, or POSTMARK_SERVER_TOKEN is required.",
    );
  if (candidates.length === 1) return candidates[0];
  const index = optional(environment, "POSTMARK_PRIMARY_SERVER_TOKEN_INDEX");
  if (index === "1" && first) return first;
  if (index === "2" && second) return second;
  throw new Error(
    "POSTMARK_PRIMARY_SERVER_TOKEN_INDEX must explicitly select token 1 or 2 when multiple Postmark server tokens are supplied.",
  );
}

function connection(
  type: BootstrapProviderType,
  input: {
    name: string;
    settings: Partial<ConnectionInput["settings"]> & { fromEmail: string };
    credentials: Record<string, string>;
    weight: number;
    perSecond: number;
    perMinute: number;
    concurrency: number;
  },
): BootstrapConnection {
  const parsed = connectionSchema.parse({
    ...input,
    type,
    transport: "api",
  });
  return {
    ...parsed,
    type: parsed.type as BootstrapProviderType,
    bootstrapKey: type,
  };
}

export function buildBootstrapPlan(environment: Environment): BootstrapPlan {
  let domain: string;
  try {
    domain = canonicalDomain(required(environment, "PRIMARY_SENDING_DOMAIN"));
  } catch {
    throw new Error("PRIMARY_SENDING_DOMAIN must be a valid domain name.");
  }
  const localPart = canonicalLocalPart(
    required(environment, "PRIMARY_FROM_LOCALPART"),
  );
  const email = senderEmail(localPart, domain);
  const displayName = required(environment, "PRIMARY_FROM_NAME");
  const replyToValue = optional(environment, "PRIMARY_REPLY_TO");
  const replyTo = replyToValue
    ? z.email().parse(replyToValue.toLowerCase())
    : "";
  const settings = { fromEmail: email, fromName: displayName, replyTo };
  const defaults = { weight: 1, perSecond: 1, perMinute: 30, concurrency: 1 };
  const mailgunRegion = oneOf(
    environment,
    "MAILGUN_REGION",
    ["US", "EU"],
    "US",
  );
  const sendgridRegion = oneOf(
    environment,
    "SENDGRID_REGION",
    ["Global", "EU"],
    "Global",
  );
  const smtp2goRegion = oneOf(
    environment,
    "SMTP2GO_REGION",
    ["Global", "US", "EU", "AU"],
    "Global",
  );
  const stream =
    optional(environment, "POSTMARK_MESSAGE_STREAM") || "broadcast";

  return {
    domain,
    sender: { localPart, email, displayName, replyTo },
    connections: [
      connection("resend", {
        name: "Resend Production — API",
        settings,
        credentials: { apiKey: required(environment, "RESEND_API_KEY") },
        ...defaults,
      }),
      connection("mailgun", {
        name: "Mailgun Production — API",
        settings: { ...settings, domain, region: mailgunRegion },
        credentials: {
          apiKey: required(environment, "MAILGUN_SENDING_API_KEY"),
          managementApiKey: required(environment, "MAILGUN_API_KEY"),
          ...optionalPair(
            environment,
            "MAILGUN_SMTP_USERNAME",
            "MAILGUN_SMTP_PASSWORD",
          ),
        },
        ...defaults,
      }),
      connection("sendgrid", {
        name: "SendGrid Production — API",
        settings: { ...settings, region: sendgridRegion },
        credentials: {
          apiKey: required(environment, "SENDGRID_API_KEY"),
          ...(optional(environment, "SENDGRID_SMTP_API_KEY")
            ? { smtpApiKey: optional(environment, "SENDGRID_SMTP_API_KEY") }
            : {}),
        },
        ...defaults,
      }),
      connection("brevo", {
        name: "Brevo Production — API",
        settings,
        credentials: {
          apiKey: required(environment, "BREVO_API_KEY"),
          ...optionalPair(environment, "BREVO_SMTP_LOGIN", "BREVO_SMTP_KEY"),
        },
        ...defaults,
      }),
      connection("postmark", {
        name: "Postmark Production — API",
        settings: {
          ...settings,
          messageStreamType: "broadcast",
          messageStream: stream,
        },
        credentials: {
          serverToken: postmarkServerToken(environment),
          ...(optional(environment, "POSTMARK_ACCOUNT_TOKEN")
            ? { accountToken: optional(environment, "POSTMARK_ACCOUNT_TOKEN") }
            : {}),
        },
        ...defaults,
      }),
      connection("mailjet", {
        name: "Mailjet Production — API",
        settings,
        credentials: {
          apiKey: required(environment, "MAILJET_API_KEY"),
          secretKey: required(environment, "MAILJET_SECRET_KEY"),
        },
        ...defaults,
      }),
      connection("smtp2go", {
        name: "SMTP2GO Production — API",
        settings: { ...settings, region: smtp2goRegion },
        credentials: {
          apiKey: required(environment, "SMTP2GO_API_KEY"),
          ...optionalPair(
            environment,
            "SMTP2GO_SMTP_USERNAME",
            "SMTP2GO_SMTP_PASSWORD",
          ),
        },
        ...defaults,
      }),
      connection("elastic", {
        name: "Elastic Email Production — API",
        settings,
        credentials: {
          apiKey: required(environment, "ELASTIC_API_KEY"),
          ...optionalPair(
            environment,
            "ELASTIC_SMTP_USERNAME",
            "ELASTIC_SMTP_PASSWORD",
          ),
        },
        ...defaults,
      }),
    ],
  };
}

export function summarizeBootstrapPlan(plan: BootstrapPlan) {
  return {
    domain: plan.domain,
    sender: plan.sender,
    providers: plan.connections.map((item) => ({
      key: item.bootstrapKey,
      name: item.name,
      type: item.type,
      transport: item.transport,
      region: item.settings.region ?? null,
      credentialFields: Object.keys(item.credentials).sort(),
      action: "upsert-disabled-pending-verification",
    })),
    deliveryPerformed: false,
  };
}

export async function selectPostmarkTokenSafely(
  environment: Environment,
  dependencies: Dependencies = {},
) {
  if (optional(environment, "POSTMARK_PRIMARY_SERVER_TOKEN_INDEX"))
    return { environment, probed: false, candidates: [] };
  const tokens = [
    optional(environment, "POSTMARK_SERVER_TOKEN_1"),
    optional(environment, "POSTMARK_SERVER_TOKEN_2"),
  ];
  if (tokens.filter(Boolean).length < 2)
    return { environment, probed: false, candidates: [] };
  const domain = canonicalDomain(
    required(environment, "PRIMARY_SENDING_DOMAIN"),
  );
  const localPart = canonicalLocalPart(
    required(environment, "PRIMARY_FROM_LOCALPART"),
  );
  const settings = {
    fromEmail: senderEmail(localPart, domain),
    fromName: required(environment, "PRIMARY_FROM_NAME"),
    replyTo: optional(environment, "PRIMARY_REPLY_TO").toLowerCase(),
    messageStreamType: "broadcast" as const,
    messageStream:
      optional(environment, "POSTMARK_MESSAGE_STREAM") || "broadcast",
  };
  const candidates = [] as {
    index: "1" | "2";
    status: string;
    authenticated: boolean;
    safeServerDetail: string | null;
  }[];
  for (const index of ["1", "2"] as const) {
    const parsed = connectionSchema.parse({
      name: `Postmark candidate ${index}`,
      type: "postmark",
      transport: "api",
      settings,
      credentials: { serverToken: tokens[Number(index) - 1] },
      weight: 1,
      perSecond: 1,
      perMinute: 30,
      concurrency: 1,
    });
    const verification = await verifyConnection(
      { ...parsed, id: `postmark-candidate-${index}` },
      dependencies,
    );
    const authenticated = ![
      "AUTH_ERROR",
      "MISSING_PERMISSION",
      "DEGRADED",
    ].includes(verification.status);
    candidates.push({
      index,
      status: verification.status,
      authenticated,
      safeServerDetail:
        verification.checks.find((item) => item.name === "Server token")
          ?.detail ?? null,
    });
  }
  const valid = candidates.filter((candidate) => candidate.authenticated);
  if (valid.length !== 1)
    throw new Error(
      valid.length
        ? "Both Postmark server tokens authenticated; set POSTMARK_PRIMARY_SERVER_TOKEN_INDEX explicitly."
        : "No Postmark server token could be safely authenticated; no token was selected.",
    );
  return {
    environment: {
      ...environment,
      POSTMARK_PRIMARY_SERVER_TOKEN_INDEX: valid[0].index,
    },
    probed: true,
    candidates,
  };
}

export async function applyBootstrapPlan(userId: string, plan: BootstrapPlan) {
  const providers = [];
  for (const item of plan.connections) {
    const { bootstrapKey, ...connectionInput } = item;
    const provider = await upsertBootstrapProvider(
      userId,
      bootstrapKey,
      connectionInput,
    );
    if (!provider) throw new Error(`Could not persist ${bootstrapKey}.`);
    providers.push({
      key: bootstrapKey,
      id: provider.id,
      type: provider.type,
      health: provider.health,
      enabled: provider.enabled,
    });
  }
  return { providers, deliveryPerformed: false };
}

export async function verifyBootstrapProviders(
  userId: string,
  plan: BootstrapPlan,
  dependencies: Dependencies = {},
) {
  const rows = await db.providerConnection.findMany({
    where: {
      userId,
      bootstrapKey: { in: [...bootstrapProviderTypes] },
      deletedAt: null,
    },
    select: { id: true, bootstrapKey: true },
  });
  const results = [];
  for (const item of plan.connections) {
    const row = rows.find(
      (candidate) => candidate.bootstrapKey === item.bootstrapKey,
    );
    if (!row)
      throw new Error(
        `${item.name} is not installed. Run providers:bootstrap --apply first.`,
      );
    const verification = await verifyProvider(userId, row.id, dependencies);
    results.push({
      key: item.bootstrapKey,
      status: verification.status,
      usable: verification.usable,
      checks: verification.checks,
      deliveryPerformed: false,
    });
  }
  return results;
}
