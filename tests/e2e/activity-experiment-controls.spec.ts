import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign } from "@emailsystem/core/campaigns";
import { db } from "@emailsystem/db";

test("Activity shows approved experiment configuration and can stop the bound run", async ({
  page,
}) => {
  const password = `Fixture-${crypto.randomUUID()}-Aa9!`;
  const email = `activity-controls-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Activity controls browser mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    const list = await importRecipients(
      user.id,
      Buffer.from("controlled-controls@example.net"),
      "activity-controls.txt",
    );
    const campaign = await createCampaign(user.id, {
      name: "Activity controls campaign",
      importId: list.id,
      from: "sender@example.com",
      subject: "Experiment controls browser proof",
      html: "<p>Experiment controls browser proof</p>",
      startKey: crypto.randomUUID(),
    });
    const profile = await db.experimentProfile.create({
      data: {
        userId: user.id,
        name: "Browser controls profile",
        authorizationRef: "AUTH-CONTROLS-2026",
        description: "Browser Activity controls proof",
        variables: {
          pacingProfile: "smooth",
          pacingIntervalMs: 2000,
          concurrency: 2,
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
        email: "controlled-controls@example.net",
      },
    });
    const now = new Date();
    const run = await db.experimentRun.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        profileVersion: 1,
        authorizationRef: "AUTH-CONTROLS-2026",
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
    await page.goto(appPath(`/activity?campaignId=${campaign.id}`));

    const card = page.getByRole("region", { name: "Controlled experiment" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Sending pattern: steady", { exact: true })).toBeVisible();
    await expect(card.getByText("Time between sends: 2s", { exact: true })).toBeVisible();
    await expect(card.getByText("Emails at once: 2", { exact: true })).toBeVisible();
    await expect(
      card.getByText("Email format: Automatic", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Character support: UTF-8", { exact: true })).toBeVisible();
    await expect(
      card.getByText("Message type: HTML email", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("controlled-controls@example.net")).toHaveCount(0);

    await card.getByRole("button", { name: "Stop experiment", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Stop controlled experiment?",
    });
    await expect(dialog).toBeVisible();
    const reason = "Operator stopped after reviewing the bounded Activity proof.";
    await dialog.getByLabel("Stop reason").fill(reason);
    const [stopResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(appPath(`/api/experiment-runs/${run.id}`)) &&
          response.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Confirm stop", exact: true }).click(),
    ]);
    expect(stopResponse.status()).toBe(200);

    await expect(card.getByText("stopped", { exact: true })).toBeVisible();
    await expect(card.getByText(reason, { exact: true })).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Stop experiment", exact: true }),
    ).toHaveCount(0);

    const persisted = await db.experimentRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { state: true, stopReason: true, stoppedAt: true },
    });
    expect(persisted.state).toBe("STOPPED");
    expect(persisted.stopReason).toBe(reason);
    expect(persisted.stoppedAt).not.toBeNull();
  } finally {
    await db.campaign.deleteMany({ where: { userId: user.id } });
    await db.experimentRun.deleteMany({ where: { userId: user.id } });
    await db.experimentProfile.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
