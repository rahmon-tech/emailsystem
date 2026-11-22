import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { appPath } from "@emailsystem/core/paths";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";

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

test("workspace shell stays usable and selected from phone through desktop", async ({
  page,
}) => {
  mkdirSync("test-results/ux-review", { recursive: true });

  await page.goto(appPath("/login"));
  await page.getByLabel("Email address").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/providers/);
  const authCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "emailsystem_session",
  );
  expect(authCookie, "sign-in must set the session cookie").toBeTruthy();
  expect(authCookie?.path).toBe(process.env.NEXT_PUBLIC_BASE_PATH || "/");

  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto(appPath("/providers"));
    await expect(page).toHaveURL(/\/providers\/?$/);
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
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
      const mobileDebug = await page.evaluate(() => ({
        url: location.href,
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        triggerCount: document.querySelectorAll('button[aria-label="Open navigation"]').length,
        triggerStyle: (() => {
          const el = document.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]');
          if (!el) return null;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            width: rect.width,
            height: rect.height,
            parentDisplay: getComputedStyle(el.parentElement!).display,
          };
        })(),
        bodyText: document.body.innerText.slice(0, 600),
      }));
      console.log("WORKSPACE_MOBILE_DEBUG", JSON.stringify(mobileDebug));
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

    await page.goto(appPath("/blast/image"));
    const activeCreate = page
      .getByRole("link", { name: "Create campaign", exact: true })
      .filter({ visible: true });
    await expect(activeCreate).toHaveAttribute("aria-current", "page");
    await assertNoViewportOverflow(page);

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
