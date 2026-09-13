import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";

const password = "Image-first-browser-password-2026";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

test("image-first composer uploads, previews and fails closed on an unsupported transport", async ({
  page,
}) => {
  const email = `image-browser-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Image browser mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    await importRecipients(
      user.id,
      Buffer.from("email\nimage-recipient@example.net\n"),
      "image-first-browser.csv",
    );

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.goto(appPath("/blast/image"));

    await expect(
      page.getByRole("heading", { name: "Image-first blast", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Standard composer", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Recipient import").click();
    await page
      .getByRole("option", { name: /image-first-browser\.csv/ })
      .click();
    await page.getByLabel("Campaign name").fill("Image browser campaign");
    await page.getByLabel("Subject").fill("Image browser verification");
    await page.getByLabel("Primary email image").setInputFiles({
      name: "hero.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByLabel("Alt text").fill("Primary campaign visual");

    await expect(page.getByText("hero.png", { exact: true })).toBeVisible();
    await expect(page.locator('img[alt="Primary campaign visual"]')).toBeVisible();

    await page.getByRole("button", { name: "Prepare preview", exact: true }).click();
    await expect(page.locator('iframe[title="Image-first email preview"]')).toBeVisible();

    await page.getByRole("button", { name: "Run pre-flight", exact: true }).click();
    await expect(page.getByText(/supports inline CID images/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send campaign", exact: true }),
    ).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/ux-review/image-first-mobile.jpg",
      type: "jpeg",
      quality: 80,
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
