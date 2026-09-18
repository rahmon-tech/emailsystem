import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";

const password = "Image-first-primary-link-password-2026";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const destination = "https://example.com/offers/september?source=image-email";

test("image-first optionally wraps the primary CID image in an http(s) destination link", async ({
  page,
}) => {
  const email = `image-link-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Image primary link mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath("/blast/image"));
    await expect(
      page.getByRole("heading", { name: "Blast", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Primary email image").setInputFiles({
      name: "linked-offer.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Linked offer");

    const link = page.getByRole("textbox", {
      name: "Image destination URL (optional)",
      exact: true,
    });
    await expect(link).toBeVisible();
    await link.fill(destination);

    await page.getByRole("button", { name: "Prepare preview", exact: true }).click();
    const preview = page.frameLocator('iframe[title="Image-first email preview"]');
    await expect(preview.locator("a")).toHaveAttribute("href", destination);
    await expect(preview.locator("a img")).toHaveAttribute("alt", "linked offer");

    await link.fill("");
    await page.getByRole("button", { name: "Prepare preview", exact: true }).click();
    await expect(preview.locator("a")).toHaveCount(0);
    await expect(preview.locator("img")).toHaveAttribute("alt", "linked offer");

    await link.fill("javascript:alert(1)");
    await expect(page.getByText("Use a complete http:// or https:// URL.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare preview", exact: true })).toBeDisabled();
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
