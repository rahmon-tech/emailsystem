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

test("image-first composer manages inline image lifecycle, copy recipients, ordinary attachments and fail-closed preflight", async ({
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
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath("/blast/image"));

    await expect(
      page.getByRole("heading", { name: "Create campaign", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Standard", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Recipient import").click();
    await page
      .getByRole("option", { name: /image-first-browser\.csv/ })
      .click();
    await page.getByLabel("Campaign name").fill("Image browser campaign");
    await page.getByLabel("Subject").fill("Image browser verification");
    await page
      .getByLabel("CC (comma separated)", { exact: true })
      .fill("COPY@example.org; copy-two@example.org");
    await page
      .getByLabel("BCC (comma separated)", { exact: true })
      .fill("blind@example.org; blind-two@example.org");
    await expect(
      page.getByText(/These addresses receive a copy of every individual email/i),
    ).toBeVisible();
    await page.getByLabel("Primary email image").setInputFiles({
      name: "hero.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByLabel("Alt text").fill("Primary campaign visual");

    await page.getByLabel("Attachments").setInputFiles({
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ordinary attachment proof"),
    });
    await expect(page.getByText("brief.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("hero.png", { exact: true })).toBeVisible();
    await expect(page.locator('img[alt="Primary campaign visual"]')).toBeVisible();

    await page.getByRole("button", { name: "Remove image", exact: true }).click();
    await expect(page.getByText("hero.png", { exact: true })).toHaveCount(0);
    await expect(page.getByText("brief.txt", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Prepare preview", exact: true }),
    ).toBeDisabled();

    await page.getByLabel("Primary email image").setInputFiles({
      name: "hero-replacement.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByLabel("Alt text").fill("Replacement campaign visual");
    await expect(
      page.getByText("hero-replacement.png", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("brief.txt", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Prepare preview", exact: true }).click();
    await expect(page.locator('iframe[title="Image-first email preview"]')).toBeVisible();

    const preflightRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/api/preflight"),
    );
    await page.getByRole("button", { name: "Check campaign", exact: true }).click();
    const request = await preflightRequest;
    expect(request.postDataJSON()).toMatchObject({
      cc: ["COPY@example.org", "copy-two@example.org"],
      bcc: ["blind@example.org", "blind-two@example.org"],
    });
    await expect(page.getByText(/supports embedded images/i)).toBeVisible();
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

test("image-first test email filters unsupported transports before any test delivery", async ({
  page,
}) => {
  const email = `image-test-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    const provider = await saveProvider(user.id, {
      name: "Image test mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "test-sender@example.com" },
    });

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath("/blast/image"));

    await page.getByLabel("Subject").fill("CID test-message verification");
    await page.getByLabel("Primary email image").setInputFiles({
      name: "test-hero.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByLabel("Alt text").fill("Controlled CID test visual");

    await page
      .getByRole("button", { name: "Send a test email", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Send a test email" }),
    ).toBeVisible();
    await expect(
      page.getByText(/none of the available sending services support this message with the image embedded/i),
    ).toBeVisible();
    await expect(page.getByLabel("Sending service")).toBeDisabled();
    await page.getByLabel("Test recipient").fill("controlled@example.net");
    await expect(
      page.getByRole("button", { name: "Send test", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("option", { name: "Image test mock", exact: true }),
    ).toHaveCount(0);
    assertProvider(provider);
    expect(
      await db.providerTestDelivery.count({ where: { providerId: provider.id } }),
    ).toBe(0);
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});

function assertProvider<T extends { id: string } | null>(
  provider: T,
): asserts provider is Exclude<T, null> {
  expect(provider).not.toBeNull();
}
