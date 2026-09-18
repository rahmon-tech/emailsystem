import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { importRecipients } from "@emailsystem/core/imports";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";

const password = "Image-first-scheduling-password-2026";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

test("image-first scheduling uses the existing local-time to ISO campaign contract", async ({
  page,
}) => {
  const email = `image-schedule-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Image scheduling mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    await importRecipients(
      user.id,
      Buffer.from("email\nscheduled-recipient@example.net\n"),
      "image-first-scheduling.csv",
    );

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath("/blast/image"));

    await page.getByLabel("Recipient import").click();
    await page
      .getByRole("option", { name: /image-first-scheduling\.csv/ })
      .click();
    await page.getByLabel("Campaign name").fill("Scheduled image campaign");
    await page.getByLabel("Subject").fill("Scheduled image verification");
    await page.getByLabel("Primary email image").setInputFiles({
      name: "scheduled-hero.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByLabel("Alt text").fill("Scheduled campaign visual");

    const scheduledLocal = "2030-01-02T15:30";
    const scheduledIso = await page.evaluate(
      (value) => new Date(value).toISOString(),
      scheduledLocal,
    );
    await page
      .getByLabel("Schedule (your local time)", { exact: true })
      .fill(scheduledLocal);

    const preflightRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/api/preflight"),
    );
    await page.getByRole("button", { name: "Check campaign", exact: true }).click();
    const request = await preflightRequest;
    expect(request.postDataJSON()).toMatchObject({ scheduledAt: scheduledIso });
    await expect(
      page.getByRole("button", { name: "Schedule campaign", exact: true }),
    ).toBeDisabled();
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
