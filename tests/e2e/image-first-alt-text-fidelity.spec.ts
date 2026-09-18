import { test, expect } from "@playwright/test";
import { appPath } from "@emailsystem/core/paths";
import { createUser } from "@emailsystem/core/auth";
import { saveProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";

const password = "Image-first-alt-text-password-2026";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

test("image-first refreshes generated alt text on replacement but preserves authored alt text", async ({
  page,
}) => {
  const email = `image-alt-${crypto.randomUUID()}@example.com`;
  const user = await createUser(email, password);
  try {
    await saveProvider(user.id, {
      name: "Image alt fidelity mock",
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
      page.getByRole("heading", { name: "Create campaign", exact: true }),
    ).toBeVisible();

    const imageInput = page.getByLabel("Primary email image");
    const alt = page.getByRole("textbox", { name: "Alt text", exact: true });

    await imageInput.setInputFiles({
      name: "first-banner.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(alt).toHaveValue("first banner");

    await imageInput.setInputFiles({
      name: "second-offer.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(alt).toHaveValue("second offer");

    await alt.fill("Hand-written accessible description");
    await imageInput.setInputFiles({
      name: "third-product.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(alt).toHaveValue("Hand-written accessible description");
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
  }
});
