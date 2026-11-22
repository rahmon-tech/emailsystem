import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";

async function ensureWorkspaceProvider() {
  const user = await db.user.findUnique({
    where: { email: E2E_EMAIL },
    select: { id: true },
  });
  expect(user, "the browser-test account must exist").not.toBeNull();
  const existing = await db.providerConnection.count({
    where: { userId: user!.id, deletedAt: null },
  });
  if (existing === 0) {
    await saveProvider(user!.id, {
      name: "Workspace shell mock",
      type: "mock",
      transport: "api",
      credentials: {},
      settings: { fromEmail: "sender@example.com" },
    });
  }
}

test("nested image-first route keeps campaign navigation and breadcrumb selected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appPath("/login"));
  await page.getByLabel("Email address").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/providers/);
  await ensureWorkspaceProvider();

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(appPath("/blast/image"));
    await expect(page).toHaveURL(new RegExp("blast/image/?$"));
    await expect(
      page.getByRole("banner").getByText("Create campaign", { exact: true }),
    ).toBeVisible();

    if (width < 900) {
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    }

    const navigation = page
      .getByRole("navigation", { name: "Main navigation" })
      .filter({ visible: true });
    await expect(
      navigation.getByRole("link", { name: "Create campaign", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    if (width < 900) await page.keyboard.press("Escape");
  }
});
