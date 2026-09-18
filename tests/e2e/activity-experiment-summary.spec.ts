import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign } from "@emailsystem/core/campaigns";
import { db } from "@emailsystem/db";

const password = `Fixture-${crypto.randomUUID()}-Aa9!`;

test("Activity shows live bounded experiment status and tenant-safe evidence export", async ({
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
    const [loginResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(appPath("/api/auth/login")) &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    expect(loginResponse.status()).toBe(200);
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath(`/activity?campaignId=${campaign.id}`));

    const card = page.getByRole("region", { name: "Controlled experiment" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Browser resilience profile", { exact: false })).toBeVisible();
    await expect(card.getByText("AUTH-BROWSER-2026", { exact: false })).toBeVisible();
    await expect(card.getByText("4 / 12", { exact: true })).toBeVisible();
    await expect(card.getByText("5 / 24", { exact: true })).toBeVisible();
    await expect(card.getByText("running", { exact: true })).toBeVisible();
    await expect(page.getByText("controlled-browser@example.net")).toHaveCount(0);

    const evidence = card.getByRole("link", { name: "Download records", exact: true });
    await expect(evidence).toHaveAttribute(
      "href",
      new RegExp(`/api/experiment-runs/${run.id}/evidence$`),
    );

    await db.experimentRun.update({
      where: { id: run.id },
      data: {
        state: "STOPPED",
        recipientsUsed: 7,
        attemptsUsed: 9,
        stoppedAt: new Date(),
        stopReason: "Operator stopped after bounded proof.",
      },
    });

    await expect(card.getByText("7 / 12", { exact: true })).toBeVisible({
      timeout: 8_000,
    });
    await expect(card.getByText("9 / 24", { exact: true })).toBeVisible();
    await expect(card.getByText("stopped", { exact: true })).toBeVisible();
    await expect(
      card.getByText("Operator stopped after bounded proof.", { exact: true }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/ux-review/activity-experiment-mobile.jpg",
      type: "jpeg",
      quality: 80,
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await db.campaign.deleteMany({ where: { userId: user.id } });
    await db.experimentRun.deleteMany({ where: { userId: user.id } });
    await db.experimentProfile.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
