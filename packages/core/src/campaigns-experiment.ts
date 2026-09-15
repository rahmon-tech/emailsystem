import { db } from "@emailsystem/db";
import { json } from "./providers";
import { createCampaign as createCampaignBase } from "./campaigns";
import { experimentVariables } from "./experiments";

export * from "./campaigns";

export async function createCampaign(userId: string, input: unknown) {
  const campaign = await createCampaignBase(userId, input);
  if (!campaign.experimentRunId) return campaign;

  const run = await db.experimentRun.findFirst({
    where: { id: campaign.experimentRunId, userId },
    select: { profile: { select: { variables: true } } },
  });
  if (!run) return campaign;

  const variables = experimentVariables.parse(run.profile.variables);
  if (variables.transportEncoding === "provider-default") return campaign;

  const message = campaign.message as Record<string, unknown>;
  return db.campaign.update({
    where: { id: campaign.id },
    data: {
      message: json({
        ...message,
        transportEncoding: variables.transportEncoding,
        charset: variables.charset,
      }),
    },
  });
}
