import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { createCampaign } from "@emailsystem/core/campaigns";
import { db } from "@emailsystem/db";

const password = "Activity-provider-browser-password-2026";

test("Activity shows live campaign provider availability", async ({ page }) => {
  const email = `activity-provider-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Activity provider browser mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    const provider = await db.providerConnection.findFirstOrThrow({
      where: { userId: user.id, name: "Activity provider browser mock" },
    });
    const list = await importRecipients(
      user.id,
      Buffer.from("provider-browser@example.net"),
      "activity-provider-browser.txt",
    );
    const campaign = await createCampaign(user.id, {
      name: "Activity provider browser campaign",
      importId: list.id,
      from: "sender@example.com",
      subject: "Provider activity browser proof",
      html: "<p>Provider activity browser proof</p>",
      startKey: crypto.randomUUID(),
    });

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath(`/activity?campaignId=${campaign.id}`));

    const panel = page.getByRole("region", {
      name: "Campaign provider availability",
    });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("Activity provider browser mock", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByText("1 of 1 eligible", { exact: true })).toBeVisible();
    await expect(panel.getByText("Eligible", { exact: true })).toBeVisible();

    await db.providerConnection.update({
      where: { id: provider.id },
      data: { cooldownUntil: new Date(Date.now() + 60_000) },
    });

    await expect(panel.getByText("0 of 1 eligible", { exact: true })).toBeVisible({
      timeout: 13_000,
    });
    await expect(panel.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(panel.getByText("Cooling down", { exact: true })).toBeVisible();
  } finally {
    // The E2E worker may have already created deliveries/attempts for this
    // campaign. Remove the campaign first so those child rows cascade before
    // the provider/user owner rows are deleted.
    await db.campaign.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
