import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { appPath } from "@emailsystem/core/paths";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";

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

const widths = [320, 375, 390, 768, 1024, 1440] as const;

async function assertNoViewportOverflow(page: import("@playwright/test").Page) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function verifySendingServiceDialogs(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Add sending service", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add sending service" });
  await expect(addDialog).toBeVisible();
  await expect(addDialog.getByRole("button", { name: "Resend", exact: true })).toBeVisible();
  await assertNoViewportOverflow(page);
  await page.keyboard.press("Escape");
  await expect(addDialog).toBeHidden();

  const sharedDialogs = [
    {
      button: "Open sending limits and protection",
      title: "Sending limits & protection",
    },
    { button: "Sending addresses", title: "Sending addresses" },
    { button: "Link tracking", title: "Links & tracking" },
  ];
  for (const item of sharedDialogs) {
    await page.getByRole("button", { name: item.button, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: item.title });
    await expect(dialog).toBeVisible();
    await assertNoViewportOverflow(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}

test("workspace shell stays usable and selected from phone through desktop", async ({
  page,
}) => {
  mkdirSync("test-results/ux-review", { recursive: true });

  await page.goto(appPath("/login"));
  await expect(page).toHaveTitle(/EmailBlast/);
  await expect(page.getByText("EmailBlast", { exact: true })).toBeVisible();
  await page.getByLabel("Email address").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Get ready to send", { exact: true })).toBeVisible();
  const authCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "emailsystem_session",
  );
  expect(authCookie, "sign-in must set the session cookie").toBeTruthy();
  expect(authCookie?.path).toBe(process.env.NEXT_PUBLIC_BASE_PATH || "/");
  // The isolated browser-test account starts without a provider. Add a mock
  // connection so both standard and image-first composer routes are reachable.
  await ensureWorkspaceProvider();

  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto(appPath("/dashboard"));
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Sending health", { exact: true })).toBeVisible();
    await assertNoViewportOverflow(page);
    if (width < 900) {
      const mobileDashboardTrigger = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      await mobileDashboardTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        drawerNav.getByRole("link", { name: "Dashboard", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Dashboard", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    if (width === 320 || width === 1440) {
      await page.screenshot({
        path: `test-results/ux-review/dashboard-${width}.jpg`,
        type: "jpeg",
        quality: 80,
        fullPage: true,
        animations: "disabled",
      });
    }


    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto(appPath("/providers"));
    await expect(page).toHaveURL(/\/providers\/?$/);
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Workspace shell mock", { exact: true }).first()).toBeVisible();
    if (width === 320 || width === 1440) {
      await verifySendingServiceDialogs(page);
    }
    await assertNoViewportOverflow(page);

    const newCampaign = page.getByRole("link", {
      name: "New campaign",
      exact: true,
    });
    if (width < 600) await expect(newCampaign).toBeHidden();
    else await expect(newCampaign).toBeVisible();

    const mobileTrigger = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    if (width < 900) {
      await expect(mobileTrigger).toBeVisible();
      await mobileTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(drawerNav).toBeVisible();
      await expect(
        page.getByText("EmailBlast", { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        drawerNav.getByRole("link", { name: "Sending services", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      await expect(mobileTrigger).toBeHidden();
      await expect(
        page.getByText("EmailBlast", { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Sending services", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }

    await page.goto(appPath("/templates"));
    await expect(page).toHaveURL(/\/templates\/?$/);
    await expect(
      page.getByRole("heading", { name: "Templates", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Starter templates/ }),
    ).toBeVisible();
    await assertNoViewportOverflow(page);
    if (width < 900) {
      await mobileTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        drawerNav.getByRole("link", { name: "Templates", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Templates", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }

    await page.goto(appPath("/audience"));
    await expect(page).toHaveURL(/\/audience\/?$/);
    await expect(
      page.getByRole("heading", { name: "Audience", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Contacts", exact: true })).toBeVisible();
    await assertNoViewportOverflow(page);
    if (width < 900) {
      await mobileTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        drawerNav.getByRole("link", { name: "Audience", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Audience", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }

    await page.goto(appPath("/blast/image"));
    await expect(page).toHaveURL(/\/blast\/image\/?$/);
    if (width < 900) {
      await mobileTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        drawerNav.getByRole("link", { name: "Create campaign", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Create campaign", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await assertNoViewportOverflow(page);

    await page.goto(appPath("/blast"));
    await expect(page).toHaveURL(new RegExp("blast/?$"));
    await expect(
      page.getByRole("heading", { name: "Create campaign", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Campaign name")).toBeVisible();
    await expect(page.getByLabel("Subject")).toBeVisible();
    if (width < 900) {
      await mobileTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        drawerNav.getByRole("link", { name: "Create campaign", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Create campaign", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await assertNoViewportOverflow(page);
    if (width === 320 || width === 1440) {
      await page.screenshot({
        path: `test-results/ux-review/campaign-${width}.jpg`,
        type: "jpeg",
        quality: 80,
        fullPage: true,
        animations: "disabled",
      });
    }

    await page.goto(appPath("/activity"));
    await expect(page).toHaveURL(new RegExp("activity/?$"));
    await expect(
      page.getByRole("heading", { name: "Activity", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Do-not-send list", exact: true }),
    ).toBeVisible();
    if (width < 900) {
      await mobileTrigger.click();
      const drawerNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        drawerNav.getByRole("link", { name: "Activity", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const desktopNav = page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true });
      await expect(
        desktopNav.getByRole("link", { name: "Activity", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await assertNoViewportOverflow(page);
    if (width === 320 || width === 1440) {
      await page.screenshot({
        path: `test-results/ux-review/activity-${width}.jpg`,
        type: "jpeg",
        quality: 80,
        fullPage: true,
        animations: "disabled",
      });
    }

    await page.goto(appPath("/providers"));
    const account = page.getByRole("button", {
      name: "Account menu",
      exact: true,
    });
    await expect(account).toBeVisible();
    await account.click();
    await expect(page.getByRole("menuitem", { name: E2E_EMAIL })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.screenshot({
      path: `test-results/ux-review/shell-${width}.jpg`,
      type: "jpeg",
      quality: 80,
      fullPage: true,
      animations: "disabled",
    });
  }
});
