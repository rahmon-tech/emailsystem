import { z } from "zod";
import { db, type Prisma } from "@emailsystem/db";
import type { Verification } from "@emailsystem/providers";
import type { ConnectionInput } from "@emailsystem/providers";
import { canonicalDomain } from "./reputation";
import { AppError } from "./errors";

const localPartSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/,
    "Use letters, numbers, dots, underscores, plus signs or hyphens.",
  );

export const canonicalLocalPart = (value: string) =>
  localPartSchema.parse(value);

export function senderEmail(localPart: string, domain: string) {
  return z
    .email()
    .parse(`${canonicalLocalPart(localPart)}@${canonicalDomain(domain)}`);
}

export type AuthorizationForSender = {
  status: string;
  scope: string;
  senderAuthorizations: { senderIdentityId: string }[];
};

export function authorizationAllowsSender(
  authorization: AuthorizationForSender,
  sender: { id: string },
) {
  return (
    authorization.status === "VERIFIED" &&
    (authorization.scope === "DOMAIN_WIDE" ||
      (authorization.scope === "ADDRESS_SPECIFIC" &&
        authorization.senderAuthorizations.some(
          (item) => item.senderIdentityId === sender.id,
        )))
  );
}

const senderInclude = {
  authorizedDomain: {
    include: {
      providerAuthorizations: {
        include: {
          providerConnection: true,
          senderAuthorizations: {
            select: { senderIdentityId: true },
          },
        },
      },
    },
  },
} satisfies Prisma.SenderIdentityInclude;

type SenderWithAuthorizations = Prisma.SenderIdentityGetPayload<{
  include: typeof senderInclude;
}>;

const providerUsable = (provider: {
  enabled: boolean;
  health: string;
  cooldownUntil: Date | null;
  settings: unknown;
}) =>
  provider.enabled &&
  provider.health === "HEALTHY" &&
  (!provider.cooldownUntil || provider.cooldownUntil <= new Date()) &&
  (provider.settings as ConnectionInput["settings"]).messageStreamType !==
    "transactional";

export function eligibleProvidersForSender(sender: SenderWithAuthorizations) {
  if (!sender.enabled || sender.authorizedDomain.status !== "VERIFIED")
    return [];
  return sender.authorizedDomain.providerAuthorizations
    .filter(
      (authorization) =>
        authorizationAllowsSender(authorization, sender) &&
        providerUsable(authorization.providerConnection) &&
        !authorization.providerConnection.deletedAt,
    )
    .map((authorization) => authorization.providerConnection);
}

export async function eligibleProvidersForSenderId(
  tx: Prisma.TransactionClient,
  userId: string,
  senderId: string,
) {
  const sender = await tx.senderIdentity.findFirst({
    where: { id: senderId, userId },
    include: senderInclude,
  });
  return sender ? eligibleProvidersForSender(sender) : [];
}

export async function resolveSender(
  userId: string,
  selection: { senderIdentityId?: string; from?: string },
) {
  const sender = await db.senderIdentity.findFirst({
    where: {
      userId,
      ...(selection.senderIdentityId
        ? { id: selection.senderIdentityId }
        : selection.from
          ? { email: selection.from.trim().toLowerCase() }
          : { id: "" }),
    },
    include: senderInclude,
  });
  if (!sender)
    throw new AppError(
      422,
      "SENDER",
      "Choose an authorized sender identity. Arbitrary From addresses are not allowed.",
    );
  if (!sender.enabled)
    throw new AppError(422, "SENDER_DISABLED", "This sender is disabled.");
  if (sender.authorizedDomain.status !== "VERIFIED")
    throw new AppError(
      422,
      "DOMAIN_UNVERIFIED",
      "This sender domain is not verified through a provider.",
    );
  return { sender, providers: eligibleProvidersForSender(sender) };
}

export async function senderForProviderTest(
  userId: string,
  providerId: string,
  selection: { senderIdentityId?: string; from?: string },
) {
  const sender = await db.senderIdentity.findFirst({
    where: {
      userId,
      enabled: true,
      ...(selection.senderIdentityId
        ? { id: selection.senderIdentityId }
        : selection.from
          ? { email: selection.from.trim().toLowerCase() }
          : { id: "" }),
    },
    include: {
      authorizedDomain: {
        include: {
          providerAuthorizations: {
            where: { providerConnectionId: providerId },
            include: {
              providerConnection: true,
              senderAuthorizations: {
                select: { senderIdentityId: true },
              },
            },
          },
        },
      },
    },
  });
  const authorization = sender?.authorizedDomain.providerAuthorizations[0];
  if (
    !sender ||
    !authorization ||
    authorization.providerConnection.deletedAt ||
    ["DISABLED", "POLICY_BLOCKED", "AUTH_ERROR"].includes(
      authorization.status,
    ) ||
    ["DISABLED", "POLICY_BLOCKED", "AUTH_ERROR"].includes(
      authorization.providerConnection.health,
    )
  )
    throw new AppError(
      422,
      "SENDER",
      "Choose a sender associated with this provider before testing.",
    );
  return { sender, authorization };
}

function evidence(
  verification: Verification,
  providerType: string,
): {
  status: string;
  scope: "DOMAIN_WIDE" | "ADDRESS_SPECIFIC";
  detail: string;
} {
  const passed = verification.checks.filter((item) => item.status === "passed");
  const domain = passed.find((item) => /^domain$/i.test(item.name));
  const address = passed.find((item) =>
    /^(sender|sandbox validation|controlled test send)$/i.test(item.name),
  );
  const simulation =
    providerType === "mock"
      ? passed.find((item) => /^simulation$/i.test(item.name))
      : undefined;
  if (domain || simulation)
    return {
      status: "VERIFIED",
      scope: "DOMAIN_WIDE",
      detail: (domain ?? simulation)!.detail,
    };
  if (address)
    return {
      status: "VERIFIED",
      scope: "ADDRESS_SPECIFIC",
      detail: address.detail,
    };
  return {
    status:
      verification.status === "HEALTHY" ? "UNVERIFIED" : verification.status,
    scope: "DOMAIN_WIDE",
    detail:
      verification.checks.find((item) => item.status !== "passed")?.detail ??
      "Provider authentication did not prove sender-domain authorization.",
  };
}

async function recomputeDomainStatus(
  tx: Prisma.TransactionClient,
  userId: string,
  domainId: string,
) {
  const verified = await tx.providerDomainAuthorization.count({
    where: { userId, authorizedDomainId: domainId, status: "VERIFIED" },
  });
  await tx.authorizedDomain.updateMany({
    where: { id: domainId, userId, status: { not: "DISABLED" } },
    data: { status: verified ? "VERIFIED" : "UNVERIFIED" },
  });
}

export async function ensureProviderIdentity(
  tx: Prisma.TransactionClient,
  userId: string,
  providerId: string,
  settings: ConnectionInput["settings"],
) {
  const email = z.email().parse(settings.fromEmail.trim().toLowerCase());
  const [localPart, rawDomain] = email.split("@");
  const domain = canonicalDomain(rawDomain);
  const authorizedDomain = await tx.authorizedDomain.upsert({
    where: { userId_domain: { userId, domain } },
    create: { userId, domain },
    update: {},
  });
  const sender = await tx.senderIdentity.upsert({
    where: { userId_email: { userId, email } },
    create: {
      userId,
      authorizedDomainId: authorizedDomain.id,
      localPart: canonicalLocalPart(localPart),
      email,
      displayName: settings.fromName,
      replyTo: settings.replyTo,
    },
    update: {
      displayName: settings.fromName,
      replyTo: settings.replyTo,
      enabled: true,
    },
  });
  const staleAuthorizations = await tx.providerDomainAuthorization.findMany({
    where: {
      userId,
      providerConnectionId: providerId,
      authorizedDomainId: { not: authorizedDomain.id },
    },
    select: { id: true, authorizedDomainId: true },
  });
  if (staleAuthorizations.length) {
    await tx.providerSenderAuthorization.deleteMany({
      where: {
        providerDomainAuthorizationId: {
          in: staleAuthorizations.map((item) => item.id),
        },
      },
    });
    await tx.providerDomainAuthorization.updateMany({
      where: { id: { in: staleAuthorizations.map((item) => item.id) }, userId },
      data: {
        status: "DISABLED",
        verifiedAt: null,
        safeDetail: "Provider is now configured for a different domain.",
      },
    });
    for (const staleDomainId of new Set(
      staleAuthorizations.map((item) => item.authorizedDomainId),
    ))
      await recomputeDomainStatus(tx, userId, staleDomainId);
  }
  const authorization = await tx.providerDomainAuthorization.upsert({
    where: {
      providerConnectionId_authorizedDomainId: {
        providerConnectionId: providerId,
        authorizedDomainId: authorizedDomain.id,
      },
    },
    create: {
      userId,
      providerConnectionId: providerId,
      authorizedDomainId: authorizedDomain.id,
      status: "UNVERIFIED",
      safeDetail: "Run provider verification.",
    },
    update: {
      status: "UNVERIFIED",
      verifiedAt: null,
      safeDetail: "Provider settings changed. Re-check authorization.",
    },
  });
  await tx.providerSenderAuthorization.deleteMany({
    where: { providerDomainAuthorizationId: authorization.id },
  });
  await recomputeDomainStatus(tx, userId, authorizedDomain.id);
  return { authorizedDomain, sender, authorization };
}

export async function syncProviderAuthorization(
  tx: Prisma.TransactionClient,
  userId: string,
  providerId: string,
  verification: Verification,
) {
  const provider = await tx.providerConnection.findFirst({
    where: { id: providerId, userId, deletedAt: null },
  });
  if (!provider) return;
  const settings = provider.settings as ConnectionInput["settings"];
  const email = settings.fromEmail.toLowerCase();
  const domainName = canonicalDomain(email.split("@")[1]);
  const domain = await tx.authorizedDomain.findUnique({
    where: { userId_domain: { userId, domain: domainName } },
  });
  const sender = await tx.senderIdentity.findUnique({
    where: { userId_email: { userId, email } },
  });
  if (!domain || !sender) return;
  const proof = evidence(verification, provider.type);
  const existing = await tx.providerDomainAuthorization.findUnique({
    where: {
      providerConnectionId_authorizedDomainId: {
        providerConnectionId: providerId,
        authorizedDomainId: domain.id,
      },
    },
  });
  const preserve =
    existing?.status === "VERIFIED" &&
    ![
      "AUTH_ERROR",
      "POLICY_BLOCKED",
      "DISABLED",
      "DOMAIN_UNVERIFIED",
      "SENDER_UNVERIFIED",
    ].includes(proof.status) &&
    proof.status !== "VERIFIED";
  if (!preserve) {
    const authorization = await tx.providerDomainAuthorization.upsert({
      where: {
        providerConnectionId_authorizedDomainId: {
          providerConnectionId: providerId,
          authorizedDomainId: domain.id,
        },
      },
      create: {
        userId,
        providerConnectionId: providerId,
        authorizedDomainId: domain.id,
        scope: proof.scope,
        status: proof.status,
        verifiedAt: proof.status === "VERIFIED" ? new Date() : null,
        safeDetail: proof.detail,
      },
      update: {
        scope: proof.scope,
        status: proof.status,
        verifiedAt: proof.status === "VERIFIED" ? new Date() : null,
        safeDetail: proof.detail,
      },
    });
    if (proof.status === "VERIFIED" && proof.scope === "ADDRESS_SPECIFIC")
      await tx.providerSenderAuthorization.upsert({
        where: {
          providerDomainAuthorizationId_senderIdentityId: {
            providerDomainAuthorizationId: authorization.id,
            senderIdentityId: sender.id,
          },
        },
        create: {
          userId,
          providerDomainAuthorizationId: authorization.id,
          senderIdentityId: sender.id,
        },
        update: {},
      });
  }
  await recomputeDomainStatus(tx, userId, domain.id);
}

export async function recordControlledSenderTest(
  userId: string,
  providerId: string,
  senderId: string,
) {
  await db.$transaction(async (tx) => {
    const sender = await tx.senderIdentity.findFirst({
      where: { id: senderId, userId },
      include: {
        authorizedDomain: {
          include: {
            providerAuthorizations: {
              where: { providerConnectionId: providerId },
            },
          },
        },
      },
    });
    const authorization = sender?.authorizedDomain.providerAuthorizations[0];
    if (!sender || !authorization) return;
    if (
      authorization.scope !== "DOMAIN_WIDE" ||
      authorization.status !== "VERIFIED"
    )
      await tx.providerDomainAuthorization.update({
        where: { id: authorization.id },
        data: {
          scope: "ADDRESS_SPECIFIC",
          status: "VERIFIED",
          verifiedAt: new Date(),
          safeDetail:
            "Provider accepted an explicit controlled test from this sender. Recipient delivery is not confirmed.",
        },
      });
    else
      await tx.providerDomainAuthorization.update({
        where: { id: authorization.id },
        data: {
          status: "VERIFIED",
          verifiedAt: new Date(),
          safeDetail:
            "Provider accepted an explicit controlled test. Recipient delivery is not confirmed.",
        },
      });
    await tx.providerSenderAuthorization.upsert({
      where: {
        providerDomainAuthorizationId_senderIdentityId: {
          providerDomainAuthorizationId: authorization.id,
          senderIdentityId: sender.id,
        },
      },
      create: {
        userId,
        providerDomainAuthorizationId: authorization.id,
        senderIdentityId: sender.id,
      },
      update: {},
    });
    await recomputeDomainStatus(tx, userId, sender.authorizedDomain.id);
  });
}

export async function listSenders(userId: string) {
  const domains = await db.authorizedDomain.findMany({
    where: { userId },
    orderBy: { domain: "asc" },
    include: {
      senderIdentities: { orderBy: { email: "asc" } },
      providerAuthorizations: {
        include: {
          providerConnection: {
            select: {
              id: true,
              name: true,
              type: true,
              enabled: true,
              health: true,
              cooldownUntil: true,
              settings: true,
              deletedAt: true,
            },
          },
          senderAuthorizations: {
            select: { senderIdentityId: true },
          },
        },
      },
    },
  });
  return {
    domains: domains.map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      status: domain.status,
      senders: domain.senderIdentities.map((sender) => ({
        id: sender.id,
        email: sender.email,
        localPart: sender.localPart,
        displayName: sender.displayName,
        replyTo: sender.replyTo,
        enabled: sender.enabled,
        availableProviderIds: domain.providerAuthorizations
          .filter(
            (authorization) =>
              authorizationAllowsSender(authorization, sender) &&
              providerUsable(authorization.providerConnection) &&
              !authorization.providerConnection.deletedAt,
          )
          .map((authorization) => authorization.providerConnectionId),
      })),
      providers: domain.providerAuthorizations.map((authorization) => ({
        id: authorization.providerConnectionId,
        name: authorization.providerConnection.name,
        type: authorization.providerConnection.type,
        connectionHealth: authorization.providerConnection.health,
        status: authorization.status,
        scope: authorization.scope,
        safeDetail: authorization.safeDetail,
      })),
    })),
  };
}

export async function addAuthorizedDomain(userId: string, input: unknown) {
  const data = z
    .object({ domain: z.string().max(253) })
    .strict()
    .parse(input);
  let domain: string;
  try {
    domain = canonicalDomain(data.domain);
  } catch {
    throw new AppError(
      400,
      "DOMAIN",
      "Enter a valid sending domain without a path or protocol.",
    );
  }
  return db.authorizedDomain.upsert({
    where: { userId_domain: { userId, domain } },
    create: { userId, domain },
    update: {},
  });
}

export async function addSenderIdentities(
  userId: string,
  domainId: string,
  input: unknown,
) {
  const data = z
    .object({
      localParts: z.array(z.string()).min(1).max(200),
      displayName: z.string().trim().max(200).default(""),
      replyTo: z.union([z.email(), z.literal("")]).default(""),
    })
    .strict()
    .parse(input);
  const parts = [...new Set(data.localParts.map(canonicalLocalPart))];
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const domain = await tx.authorizedDomain.findFirst({
      where: { id: domainId, userId },
    });
    if (!domain)
      throw new AppError(404, "NOT_FOUND", "Sending domain not found.");
    const existing = await tx.senderIdentity.findMany({
      where: { authorizedDomainId: domain.id, localPart: { in: parts } },
      select: { localPart: true },
    });
    const present = new Set(existing.map((item) => item.localPart));
    const additions = parts.filter((part) => !present.has(part));
    if (
      (await tx.senderIdentity.count({ where: { userId } })) +
        additions.length >
      1000
    )
      throw new AppError(422, "SENDER_LIMIT", "Sender identity limit reached.");
    await tx.senderIdentity.createMany({
      data: additions.map((localPart) => ({
        userId,
        authorizedDomainId: domain.id,
        localPart,
        email: senderEmail(localPart, domain.domain),
        displayName: data.displayName,
        replyTo: data.replyTo.toLowerCase(),
      })),
    });
  });
  return listSenders(userId);
}

export async function setSenderEnabled(
  userId: string,
  senderId: string,
  enabled: boolean,
) {
  const changed = await db.senderIdentity.updateMany({
    where: { id: senderId, userId },
    data: { enabled },
  });
  if (!changed.count)
    throw new AppError(404, "NOT_FOUND", "Sender identity not found.");
  return { enabled };
}

export async function providerStillAuthorized(
  tx: Prisma.TransactionClient,
  userId: string,
  providerId: string,
  senderId: string,
) {
  const sender = await tx.senderIdentity.findFirst({
    where: { id: senderId, userId, enabled: true },
    include: {
      authorizedDomain: {
        include: {
          providerAuthorizations: {
            where: { providerConnectionId: providerId },
            include: {
              providerConnection: true,
              senderAuthorizations: {
                select: { senderIdentityId: true },
              },
            },
          },
        },
      },
    },
  });
  const authorization = sender?.authorizedDomain.providerAuthorizations[0];
  return !!(
    sender &&
    sender.authorizedDomain.status === "VERIFIED" &&
    authorization &&
    authorizationAllowsSender(authorization, sender) &&
    providerUsable(authorization.providerConnection) &&
    !authorization.providerConnection.deletedAt
  );
}
