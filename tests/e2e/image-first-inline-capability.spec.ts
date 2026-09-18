import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";

const password = "Image-first-inline-capability-password-2026";

async function makeEligible(userId: string, providerId: string) {
  await db.$transaction([
    db.providerConnection.update({
      where: { id: providerId },
      data: { enabled: true, health: "HEALTHY" },
    }),
    db.providerDomainAuthorization.updateMany({
      where: { userId, providerConnectionId: providerId },
      data: {
        status: "VERIFIED",
        scope: "DOMAIN_WIDE",
        verifiedAt: new Date(),
      },
    }),
  ]);
}

test("image-first shows inline CID capability as soon as the sender is selected", async ({
  page,
}) => {
  const email = `image-inline-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    const smtp = await saveProvider(user.id, {
      name: "CID SMTP",
      type: "smtp",
      transport: "smtp",
      credentials: {
        username: "smtp-user",
        password: "smtp-password",
      },
      settings: {
        fromEmail: "sender@example.com",
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
      },
    });
    const mock = await saveProvider(user.id, {
      name: "API without CID",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
    expect(smtp).not.toBeNull();
    expect(mock).not.toBeNull();
    if (!smtp || !mock) throw new Error("Provider setup failed");
    await makeEligible(user.id, smtp.id);
    await makeEligible(user.id, mock.id);

    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);
    await page.goto(appPath("/blast/image"));

    await page.getByLabel("Sending domain").click();
    await page.getByRole("option", { name: /^example\.com/ }).click();

    await expect(
      page.getByText(
        "Inline CID ready · 1 of 2 eligible providers can send this Image-first message.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("CID SMTP", { exact: true })).toBeVisible();
    await expect(page.getByText("API without CID", { exact: true })).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Run pre-flight", exact: true }),
    ).toBeDisabled();
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
