import { db } from "@emailsystem/db";
import { AppError } from "./errors";

const terminalStates = new Set([
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
  "CANCELLED",
]);

export async function archivedCampaignIds(userId: string) {
  const rows = await db.auditEvent.findMany({
    where: { userId, action: "campaign.archived" },
    select: { resourceId: true },
  });
  return [...new Set(rows.map((row) => row.resourceId))];
}

export async function listVisibleCampaigns(userId: string, cursor?: string) {
  const archived = await archivedCampaignIds(userId);
  const hidden = archived.length ? { id: { notIn: archived } } : {};
  if (
    cursor &&
    !(await db.campaign.findFirst({
      where: { id: cursor, userId, ...hidden },
      select: { id: true },
    }))
  )
    throw new AppError(400, "CURSOR", "Invalid page cursor.");
  const rows = await db.campaign.findMany({
    where: { userId, ...hidden },
    select: {
      id: true,
      name: true,
      state: true,
      recipientCount: true,
      intendedRecipientCount: true,
      createdAt: true,
      completedAt: true,
      scheduledAt: true,
      safeError: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 31,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return {
    items: rows.slice(0, 30),
    nextCursor: rows.length > 30 ? rows[29].id : null,
  };
}

export async function archiveCampaign(userId: string, campaignId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, userId },
    select: { id: true, state: true },
  });
  if (!campaign)
    throw new AppError(404, "NOT_FOUND", "Campaign not found.");
  if (!terminalStates.has(campaign.state))
    throw new AppError(
      409,
      "CAMPAIGN_ACTIVE",
      "Cancel the campaign or wait for it to finish before removing it from Activity.",
    );
  const existing = await db.auditEvent.findFirst({
    where: {
      userId,
      action: "campaign.archived",
      resourceId: campaignId,
    },
    select: { id: true },
  });
  if (!existing)
    await db.auditEvent.create({
      data: {
        userId,
        action: "campaign.archived",
        resourceId: campaignId,
      },
    });
  return { removed: true };
}

export function canArchiveCampaign(state: string) {
  return terminalStates.has(state);
}
