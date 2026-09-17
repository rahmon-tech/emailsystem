import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign } from "@emailsystem/core/campaigns";
import { appendExperimentEvidence } from "@emailsystem/core/experiment-evidence";
import { db } from "@emailsystem/db";

test("Activity reviews the evidence chain live without exposing evidence payloads", async ({
  page,
}) => {
  const password = `Fixture-${crypto.randomUUID()}-Aa9!`;
  const email = `activity-evidence-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Activity evidence browser mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    const list = await importRecipients(
      user.id,
      Buffer.from("controlled-evidence@example.net"),
      "activity-evidence.txt",
    );
    const campaign = await createCampaign(user.id, {
      name: "Activity evidence campaign",
      importId: list.id,
      from: "sender@example.com",
      subject: "Experiment evidence browser proof",
      html: "<p>Experiment evidence browser proof</p>",
      startKey: crypto.randomUUID(),
    });
    const profile = await db.experimentProfile.create({
      data: {
        userId: user.id,
        name: "Browser evidence profile",
        authorizationRef: "AUTH-EVIDENCE-BROWSER",
        description: "Browser Activity evidence proof",
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
    const now = new Date();
    const run = await db.experimentRun.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        profileVersion: 1,
        authorizationRef: "AUTH-EVIDENCE-BROWSER",
        state: "RUNNING",
        maxRecipients: 12,
        maxAttempts: 24,
        maxDurationSeconds: 3600,
        startsAt: now,
        startedAt: now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { experimentRunId: run.id },
    });
    await db.$transaction((tx) =>
      appendExperimentEvidence(tx, {
        userId: user.id,
        runId: run.id,
        kind: "run.started",
        campaignId: campaign.id,
        payload: { privateNote: "browser-secret-must-not-render" },
      }),
    );

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

    const card = page.getByRole("region", { name: "Experiment evidence review" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Chain verified", { exact: true })).toBeVisible();
    await expect(card).toContainText("1 chained entries");
    await expect(card).toContainText("#1 · run started");
    await expect(page.getByText("browser-secret-must-not-render")).toHaveCount(0);

    await db.$transaction((tx) =>
      appendExperimentEvidence(tx, {
        userId: user.id,
        runId: run.id,
        kind: "transport.outcome",
        campaignId: campaign.id,
        payload: {
          status: "accepted",
          providerMessageId: "browser-message-id-must-not-render",
        },
      }),
    );

    await expect(card).toContainText("2 chained entries", { timeout: 15_000 });
    await expect(card).toContainText("#2 · transport outcome");
    await expect(page.getByText("browser-message-id-must-not-render")).toHaveCount(0);
  } finally {
    await db.campaign.deleteMany({ where: { userId: user.id } });
    await db.experimentEvidence.deleteMany({ where: { userId: user.id } });
    await db.experimentRun.deleteMany({ where: { userId: user.id } });
    await db.experimentProfile.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
