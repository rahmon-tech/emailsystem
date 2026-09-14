import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { saveTrackingSettings } from "@emailsystem/core/tracking";
import { db } from "@emailsystem/db";

const password = "Image-first-tags-tracking-password-2026";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

test("image-first reuses account tracking defaults and the existing campaign tags contract", async ({
  page,
}) => {
  const email = `image-tags-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveTrackingSettings(user.id, {
      defaultEnabled: true,
      blockUnknown: false,
    });
    await saveProvider(user.id, {
      name: "Image tags tracking mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    await importRecipients(
      user.id,
      Buffer.from("email\nimage-tags-recipient@example.net\n"),
      "image-first-tags-tracking.csv",
    );

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath("/blast/image"));

    const tracking = page.getByRole("checkbox", {
      name: "Track clicks",
      exact: true,
    });
    await expect(tracking).toBeChecked();
    await tracking.uncheck();
    await expect(tracking).not.toBeChecked();
    await tracking.check();
    await expect(tracking).toBeChecked();

    await page.getByLabel("Recipient import").click();
    await page
      .getByRole("option", { name: /image-first-tags-tracking\.csv/ })
      .click();
    await page.getByLabel("Campaign name").fill("Image tags tracking campaign");
    await page.getByLabel("Subject").fill("Image tags tracking verification");
    await page
      .getByLabel("Tags (comma separated)", { exact: true })
      .fill("launch; VIP, image");
    await page.getByLabel("Primary email image").setInputFiles({
      name: "tags-tracking-hero.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("textbox", { name: "Alt text", exact: true })
      .fill("Tags tracking campaign visual");

    const preflightRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/api/preflight"),
    );
    await page.getByRole("button", { name: "Run pre-flight", exact: true }).click();
    const request = await preflightRequest;
    expect(request.postDataJSON()).toMatchObject({
      tags: ["launch", "VIP", "image"],
      tracking: { enabled: true },
    });
    await expect(
      page.getByText(
        "Tracking on · click links will be rewritten when the campaign snapshot is created.",
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
