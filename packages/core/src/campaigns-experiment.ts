import { db } from "@emailsystem/db";
import { json } from "./providers";
import {
  createCampaign as createCampaignBase,
  messageInput,
  preflight as preflightBase,
} from "./campaigns";
import { AppError } from "./errors";
import { experimentVariables } from "./experiments";

export * from "./campaigns";

async function assertExperimentContentMode(userId: string, input: unknown) {
  const data = messageInput.parse(input);
  if (!data.experimentRunId) return;

  const run = await db.experimentRun.findFirst({
    where: { id: data.experimentRunId, userId },
    select: { profile: { select: { variables: true } } },
  });
  if (!run) return;

  const variables = experimentVariables.parse(run.profile.variables);
  if (variables.contentMode !== "cid-inline") return;

  const html = data.html.toLowerCase();
  const hasReferencedInlineAttachment = data.attachments.some(
    (attachment) =>
      attachment.disposition === "inline" &&
      !!attachment.contentId &&
      html.includes(`cid:${attachment.contentId.toLowerCase()}`),
  );
  if (!hasReferencedInlineAttachment)
    throw new AppError(
      422,
      "EXPERIMENT_CONTENT_MODE",
      "CID-inline experiment content requires at least one inline CID attachment referenced by the email HTML.",
    );
}

export async function preflight(userId: string, input: unknown) {
  await assertExperimentContentMode(userId, input);
  return preflightBase(userId, input);
}

export async function createCampaign(userId: string, input: unknown) {
  await assertExperimentContentMode(userId, input);
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
