import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser, sessionCookie } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";
import { connection } from "../fixtures";

const email = "mobile-session@example.com";
const password = "Mobile-session-regression-2026";

test("iPhone Blast stays centered and session survives hard reload", async ({
  page,
  context,
}) => {
  let user = await db.user.findUnique({ where: { email } });
  if (!user) user = await createUser(email, password);
  if (!(await db.providerConnection.count({ where: { userId: user.id } }))) {
    const { id: _id, ...input } = connection("mock");
    await saveProvider(user.id, { ...input, name: "Mobile layout mock" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appPath("/login"));
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/blast$/);
  await expect(page.getByRole("heading", { name: "Blast" })).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Blast" })).toBeVisible();

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

  for (const name of ["Run pre-flight", "Send campaign", "Send a test email"]) {
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
