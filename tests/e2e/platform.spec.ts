import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("login, provider setup, HTML import, preview, test, campaign controls, recovery and export", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("Email address").fill("browser-test@example.com");
  await page.getByLabel("Password").fill("Isolated-browser-test-password-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/providers/);
  await expect(page.getByText("No providers configured yet.")).toBeVisible();
  await page.getByRole("button", { name: /Development Mock/ }).click();
  await page.getByLabel("Connection name").fill("Browser verification");
  await page.getByLabel("From email").fill("invalid-address");
  await page
    .getByRole("button", { name: "Save & Verify", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/email/i);
  await page.getByLabel("From email").fill("sender@example.com");
  await page
    .getByRole("button", { name: "Save & Verify", exact: true })
    .click();
  await expect(page.getByText("healthy", { exact: true })).toBeVisible();
  const providers = await (await context.request.get("/api/providers")).json();
  expect(providers).toHaveLength(1);
  expect(providers[0]).not.toHaveProperty("credentials");
  await page
    .getByRole("button", { name: "Test Browser verification", exact: true })
    .click();
  await page.getByLabel("Test recipient").fill("test@example.net");
  await page
    .getByRole("button", { name: "Send Test Email", exact: true })
    .click();
  await expect(
    page.getByText("Provider accepted the test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/blast");
  await page.getByLabel("Recipient file").setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "email\none@example.net\none@example.net\ntwo@example.net\nbad\n",
    ),
  });
  await expect(page.getByText("1 duplicate", { exact: true })).toBeVisible();
  await page.getByLabel("Campaign name").fill("Browser campaign");
  await page.getByLabel("Subject").fill("Browser verification");
  await page
    .getByRole("textbox", { name: "Email body", exact: true })
    .fill("A rich text message");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByLabel("HTML file").setInputFiles({
    name: "message.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<html><head><style>@media(max-width:480px){td{padding:12px}}</style></head><body><table width="100%"><tr><td><h1>Delivery check</h1><p>Preserved HTML layout.</p></td></tr></table><script>throw Error("unsafe")</script></body></html>',
    ),
  });
  await page
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mobile preview", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="mobile email preview"]')
      .getByRole("heading", { name: "Delivery check" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Desktop preview", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="desktop email preview"]')
      .getByRole("heading", { name: "Delivery check" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run pre-flight", exact: true })
    .click();
  await expect(page.getByText("Ready to send", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Send campaign", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm send", exact: true }).click();
  await expect(page).toHaveURL(/activity\?campaignId=/);
  await expect(
    page.getByRole("log", { name: "Campaign events" }),
  ).toContainText("DELIVERED");
  const campaignId = new URL(page.url()).searchParams.get("campaignId")!;
  await expect
    .poll(async () => {
      const s = await (
        await context.request.get("/api/campaigns/" + campaignId)
      ).json();
      return s.counts.DELIVERED;
    })
    .toBe(2);
  const exported = await context.request.get(
    `/api/campaigns/${campaignId}/export`,
  );
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toContain("DELIVERED");
  const form = new FormData();
  form.set(
    "paste",
    Array.from({ length: 40 }, (_, i) => `queued${i}@example.net`).join("\n"),
  );
  const imported = await (
    await context.request.post("/api/imports", {
      multipart: {
        paste: Array.from(
          { length: 40 },
          (_, i) => `queued${i}@example.net`,
        ).join("\n"),
      },
      headers: { Origin: "https://localhost:3443" },
    })
  ).json();
  const started = await (
    await context.request.post("/api/campaigns", {
      data: {
        name: "Control verification",
        from: "sender@example.com",
        subject: "Controls",
        html: "<p>Control test</p>",
        importId: imported.id,
        startKey: crypto.randomUUID(),
      },
      headers: { Origin: "https://localhost:3443" },
    })
  ).json();
  await page.goto("/activity?campaignId=" + started.id);
  await page
    .getByRole("button", { name: "Pause campaign", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume campaign", exact: true }),
  ).toBeVisible();
  const oldPid = Number(
    readFileSync("/tmp/emailsystem-e2e-worker.pid", "utf8"),
  );
  process.kill(oldPid, "SIGTERM");
  await expect
    .poll(() => Number(readFileSync("/tmp/emailsystem-e2e-worker.pid", "utf8")))
    .not.toBe(oldPid);
  await page.reload();
  const acceptedBefore = (
    await (await context.request.get("/api/campaigns/" + started.id)).json()
  ).acceptedCount;
  await page
    .getByRole("button", { name: "Resume campaign", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause campaign", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get("/api/campaigns/" + started.id)
          ).json()
        ).acceptedCount,
    )
    .toBeGreaterThan(acceptedBefore);
  await page
    .getByRole("button", { name: "Cancel campaign", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect
    .poll(async () => {
      const c = await (
        await context.request.get("/api/campaigns/" + started.id)
      ).json();
      return c.state;
    })
    .toBe("CANCELLED");
  for (const width of [390, 430, 768, 1366, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/providers", "/blast", "/activity"]) {
      await page.goto(route);
      await page.screenshot({
        path: `test-results/${route.slice(1)}-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
