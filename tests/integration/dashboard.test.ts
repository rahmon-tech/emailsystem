import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { dashboard } from "@emailsystem/core/dashboard";

const users: string[] = [];

after(async () => {
  if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("dashboard is useful for a brand-new installation and summarizes real campaign outcomes", async () => {
  const user = await db.user.create({
    data: {
      email: crypto.randomUUID() + "@example.com",
      passwordHash: "test-only",
    },
  });
  users.push(user.id);

  const empty = await dashboard(user.id, new Date("2026-11-27T00:00:00Z"));
  assert.equal(empty.metrics.delivered, 0);
  assert.equal(empty.metrics.bounceRate, 0);
  assert.equal(empty.readiness.completedSteps, 0);
  assert.equal(empty.readiness.totalSteps, 4);
  assert.equal(empty.recentCampaigns.length, 0);

  const list = await db.contactImport.create({
    data: {
      userId: user.id,
      filename: "customers.csv",
      state: "READY",
      stats: {
        rows: 4,
        valid: 4,
        invalid: 0,
        duplicate: 0,
        suppressed: 0,
        sendable: 4,
      },
    },
  });
  const campaign = await db.campaign.create({
    data: {
      userId: user.id,
      name: "November launch",
      state: "COMPLETED_WITH_ERRORS",
      message: {
        from: "hello@example.com",
        subject: "Launch",
        html: "<p>Hello</p>",
        text: "Hello",
      },
      importId: list.id,
      intendedRecipientCount: 4,
      recipientCount: 4,
      startKey: crypto.randomUUID(),
      scheduledAt: new Date("2026-11-27T01:00:00Z"),
      completedAt: new Date("2026-11-27T02:00:00Z"),
      createdAt: new Date("2026-11-27T00:30:00Z"),
    },
  });

  const states = ["DELIVERED", "DELIVERED", "HARD_BOUNCED", "COMPLAINED"] as const;
  for (const [index, state] of states.entries()) {
    await db.delivery.create({
      data: {
        userId: user.id,
        campaignId: campaign.id,
        email: "person" + index + "@example.net",
        state,
        unsubscribeToken: crypto.randomUUID(),
        unsubscribeHash: crypto.randomUUID(),
        createdAt: new Date("2026-11-27T01:00:00Z"),
        ...(state === "DELIVERED"
          ? { deliveredAt: new Date("2026-11-27T01:30:00Z") }
          : {}),
      },
    });
  }

  const value = await dashboard(user.id, new Date("2026-11-27T05:00:00Z"));
  assert.equal(value.metrics.delivered, 2);
  assert.equal(value.metrics.hardBounces, 1);
  assert.equal(value.metrics.complaints, 1);
  assert.equal(value.metrics.attempted, 4);
  assert.equal(value.metrics.bounceRate, 0.25);
  assert.equal(value.metrics.complaintRate, 0.25);
  assert.equal(value.metrics.savedLists, 1);
  assert.equal(value.readiness.steps.find((step) => step.key === "recipients")?.complete, true);
  assert.equal(value.readiness.steps.find((step) => step.key === "campaign")?.complete, true);
  assert.equal(value.recentCampaigns[0]?.name, "November launch");
  assert.equal(value.recentCampaigns[0]?.delivered, 2);
  assert.equal(value.recentCampaigns[0]?.bounced, 1);
});
