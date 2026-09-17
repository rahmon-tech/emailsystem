import type { Prisma } from "@emailsystem/db";
import type { ConnectionInput } from "@emailsystem/providers";
import { authorizationAllowsSender } from "./senders";

const senderProviderInclude = {
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

type SenderWithProviders = Prisma.SenderIdentityGetPayload<{
  include: typeof senderProviderInclude;
}>;

type Provider = SenderWithProviders["authorizedDomain"]["providerAuthorizations"][number]["providerConnection"];

function structurallyUsable(provider: Provider) {
  return (
    provider.enabled &&
    provider.health === "HEALTHY" &&
    !provider.deletedAt &&
    (provider.settings as ConnectionInput["settings"]).messageStreamType !==
      "transactional"
  );
}

export async function senderProviderAvailabilityForId(
  tx: Prisma.TransactionClient,
  userId: string,
  senderId: string,
  now = new Date(),
) {
  const sender = await tx.senderIdentity.findFirst({
    where: { id: senderId, userId },
    include: senderProviderInclude,
  });
  if (!sender || !sender.enabled || sender.authorizedDomain.status !== "VERIFIED")
    return { eligible: [] as Provider[], cooling: [] as Provider[] };

  const providers = sender.authorizedDomain.providerAuthorizations
    .filter((authorization) => authorizationAllowsSender(authorization, sender))
    .map((authorization) => authorization.providerConnection)
    .filter(structurallyUsable);

  return {
    eligible: providers.filter(
      (provider) => !provider.cooldownUntil || provider.cooldownUntil <= now,
    ),
    cooling: providers.filter(
      (provider) => !!provider.cooldownUntil && provider.cooldownUntil > now,
    ),
  };
}
