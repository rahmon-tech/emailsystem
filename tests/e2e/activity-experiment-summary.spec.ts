import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign } from "@emailsystem/core/campaigns";
import { db } from "@emailsystem/db";

const password = "Activity-experiment-browser-password-2026";

test("Activity shows bounded experiment status and tenant-safe evidence export", async ({
  page,
}) => {
  const email = `activity-experiment-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Activity experiment browser mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    const list = await importRecipients(
      user.id,
      Buffer.from("controlled-browser@example.net"),
      "activity-experiment-browser.txt",
    );
    const campaign = await createCampaign(user.id, {
      name: "Activity experiment browser campaign",
      importId: list.id,
      from: "sender@example.com",
      subject: "Experiment activity browser proof",
      html: "<p>Experiment activity browser proof</p>",
      startKey: crypto.randomUUID(),
    });
    const profile = await db.experimentProfile.create({
      data: {
        userId: user.id,
        name: "Browser resilience profile",
        authorizationRef: "AUTH-BROWSER-2026",
        description: "Browser Activity proof",
        variables: {
          pacingProfile: "smooth",
          transportEncoding: "provider-default",
          charset: "utf-8",
          contentMode: "html",
        },
        maxRecipients: 12,
        maxAttempts: 24,
        maxDurationSeconds: 3600,
      },
    });
    await db.experimentRecipient.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        email: "controlled-browser@example.net",
      },
    });
    const now = new Date();
    const run = await db.experimentRun.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        profileVersion: 1,
        authorizationRef: "AUTH-BROWSER-2026",
        state: "RUNNING",
        maxRecipients: 12,
        maxAttempts: 24,
        maxDurationSeconds: 3600,
        recipientsUsed: 4,
        attemptsUsed: 5,
        startsAt: now,
        startedAt: now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { experimentRunId: run.id },
    });

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.goto(appPath(`/activity?campaignId=${campaign.id}`));

    const card = page.getByRole("region", { name: "Authorized experiment" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Browser resilience profile", { exact: false })).toBeVisible();
    await expect(card.getByText("AUTH-BROWSER-2026", { exact: false })).toBeVisible();
    await expect(card.getByText("4 / 12", { exact: true })).toBeVisible();
    await expect(card.getByText("5 / 24", { exact: true })).toBeVisible();
    await expect(card.getByText("running", { exact: true })).toBeVisible();
    await expect(page.getByText("controlled-browser@example.net")).toHaveCount(0);

    const evidence = card.getByRole("link", { name: "Export evidence", exact: true });
    await expect(evidence).toHaveAttribute(
      "href",
      new RegExp(`/api/experiment-runs/${run.id}/evidence$`),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/ux-review/activity-experiment-mobile.jpg",
      type: "jpeg",
      quality: 80,
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await db.campaign.updateMany({
      where: { userId: user.id },
      data: { experimentRunId: null },
    });
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
