import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { db } from "@emailsystem/db";

const password = "Image-recipient-test-password-2026";

test("image-first supports pasted recipients and explains unready sending domains", async ({ page }) => {
  const email = `image-paste-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await db.authorizedDomain.create({
      data: { userId: user.id, domain: "unready-example.org", status: "UNVERIFIED" },
    });
    await page.goto(appPath("/login"));
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/blast$/);

    await page.goto(appPath("/blast/image"));
    await expect(page.getByText(/No domains are ready/i)).toBeVisible();
    await page.getByLabel("Sending domains").click();
    const unavailableDomain = page.getByRole("option", {
      name: /unready-example\.org.*not ready/i,
    });
    await expect(unavailableDomain).toBeVisible();
    await expect(unavailableDomain).toBeDisabled();
    await page.keyboard.press("Escape");

    await page.getByText("Or paste email addresses").click();
    await page.getByLabel("One email per line").fill(
      "alpha@example.net; BETA@example.net, alpha@example.net\ninvalid-address",
    );
    await page.getByRole("button", { name: "Import pasted addresses" }).click();
    await expect(page.getByText(/2 recipients ready from pasted\.txt/i)).toBeVisible();

    const imported = await db.contactImport.findFirst({
      where: { userId: user.id, filename: "pasted.txt" },
    });
    expect(imported).toBeTruthy();
    const recipients = await db.importRecipient.findMany({
      where: { userId: user.id, importId: imported!.id },
      select: { email: true },
      orderBy: { email: "asc" },
    });
    expect(recipients).toEqual([
      { email: "alpha@example.net" },
      { email: "beta@example.net" },
    ]);
    await expect(page.getByRole("button", { name: "Check campaign" })).toBeDisabled();
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
