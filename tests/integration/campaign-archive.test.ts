import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { createUser } from "@emailsystem/core/auth";
import {
  archiveCampaign,
  listVisibleCampaigns,
} from "@emailsystem/core/campaign-archive";
import { AppError } from "@emailsystem/core/errors";

const users: string[] = [];

after(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("finished campaigns can be removed from Activity without deleting history", async () => {
  const owner = await createUser(
    "archive-" + crypto.randomUUID() + "@example.com",
    "A strong test password 2026",
  );
  const other = await createUser(
    "archive-" + crypto.randomUUID() + "@example.com",
    "Another strong password 2026",
  );
  users.push(owner.id, other.id);

  const campaign = await db.campaign.create({
    data: {
      userId: owner.id,
      name: "Archive me",
      state: "DRAFT",
      message: {},
      importId: crypto.randomUUID(),
      startKey: crypto.randomUUID(),
    },
  });

  await assert.rejects(
    () => archiveCampaign(owner.id, campaign.id),
    (error) =>
      error instanceof AppError &&
      error.status === 409 &&
      error.code === "CAMPAIGN_ACTIVE",
  );

  await db.campaign.update({
    where: { id: campaign.id },
    data: { state: "COMPLETED", completedAt: new Date() },
  });
  await db.activityEvent.create({
    data: {
      userId: owner.id,
      campaignId: campaign.id,
      kind: "COMPLETED",
      message: "Campaign completed.",
    },
  });

  await assert.rejects(
    () => archiveCampaign(other.id, campaign.id),
    (error) =>
      error instanceof AppError &&
      error.status === 404 &&
      error.code === "NOT_FOUND",
  );

  const before = await listVisibleCampaigns(owner.id);
  assert(before.items.some((item) => item.id === campaign.id));

  assert.deepEqual(await archiveCampaign(owner.id, campaign.id), {
    removed: true,
  });
  const afterArchive = await listVisibleCampaigns(owner.id);
  assert(!afterArchive.items.some((item) => item.id === campaign.id));

  const preserved = await db.campaign.findUnique({
    where: { id: campaign.id },
    include: { activity: true },
  });
  assert(preserved);
  assert.equal(preserved.activity.length, 1);

  assert.deepEqual(await archiveCampaign(owner.id, campaign.id), {
    removed: true,
  });
  assert.equal(
    await db.auditEvent.count({
      where: {
        userId: owner.id,
        action: "campaign.archived",
        resourceId: campaign.id,
      },
    }),
    1,
  );
});
