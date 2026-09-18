import { test, expect, type Page } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser, sessionCookie } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";
import { connection } from "../fixtures";

const email = "mobile-session@example.com";
const password = "Mobile-session-regression-2026";

async function ensureMobileUser() {
  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  const user = existing ?? (await createUser(email, password));
  if (!(await db.providerConnection.count({ where: { userId: user.id } }))) {
    const { id: fixtureId, ...input } = connection("mock");
    void fixtureId;
    await saveProvider(user.id, { ...input, name: "Mobile layout mock" });
  }
  return user;
}

async function signIn(page: Page) {
  await page.goto(appPath("/login"));
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/blast$/);
  await expect(page.getByRole("heading", { name: "Create campaign" })).toBeVisible();
}

test("iPhone Blast stays centered and session survives hard reload", async ({
  page,
  context,
}) => {
  await ensureMobileUser();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const authCookie = (await context.cookies()).find(
    (cookie) => cookie.name === sessionCookie,
  );
  expect(authCookie).toBeTruthy();
  expect(authCookie!.path).toBe(process.env.NEXT_PUBLIC_BASE_PATH || "/");
  expect(authCookie!.expires - Date.now() / 1000).toBeGreaterThan(25 * 86400);

  // A real reload exercises the server layout/page session checks before any
  // client refresh request can run.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/blast$/);
  await expect(page.getByRole("heading", { name: "Create campaign" })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main");
    const content = main?.firstElementChild as HTMLElement | null;
    const rect = content?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      scrollWidth: root.scrollWidth,
      left: rect?.left ?? -1,
      right: rect ? window.innerWidth - rect.right : -1,
      width: rect?.width ?? -1,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(15);
  expect(geometry.right).toBeGreaterThanOrEqual(15);
  expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(2);
  expect(geometry.width).toBeLessThan(geometry.viewport);

  for (const name of ["Check campaign", "Send campaign", "Send a test email"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toContainText(name);
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(220);
    expect(box!.x).toBeGreaterThanOrEqual(15);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(Math.abs(box!.x + box!.width / 2 - 195)).toBeLessThanOrEqual(3);
  }
});

test.describe("Blast touch focus stability", () => {
  test.use({
    viewport: { width: 932, height: 430 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });

  test("landscape touch fields do not trigger Safari-style focus zoom", async ({
    page,
  }) => {
    await ensureMobileUser();
    await signIn(page);

    expect(
      await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
    ).toBe(true);

    const input = page.getByLabel("Campaign name");
    await expect(input).toBeVisible();

    const before = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector("main")?.getBoundingClientRect().width ?? -1,
    }));

    // iOS Safari automatically zooms focused form controls below 16px. The
    // landscape viewport is wider than MUI's `sm` breakpoint, so this proves
    // touch-device protection rather than a narrow-screen-only workaround.
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "16px",
    );

    await input.focus();
    await expect(input).toBeFocused();

    const after = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector("main")?.getBoundingClientRect().width ?? -1,
    }));

    expect(after.scrollWidth).toBeLessThanOrEqual(after.viewport + 1);
    expect(after.viewport).toBe(before.viewport);
    expect(Math.abs(after.mainWidth - before.mainWidth)).toBeLessThanOrEqual(1);
  });
});
