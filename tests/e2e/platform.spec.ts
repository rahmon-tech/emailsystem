import { appPath } from "@emailsystem/core/paths";
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
test("login, provider setup, HTML import, preview, test, campaign controls, recovery and export", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  mkdirSync("test-results/ux-review", { recursive: true });
  const review = async (name: string, fullPage = true, resetScroll = true) => {
    await page.mouse.move(0, 0);
    if (resetScroll) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/ux-review/${name}.jpg`,
      type: "jpeg",
      quality: 75,
      fullPage,
      animations: "disabled",
    });
  };
  const chooseProvider = async (name: string) => {
    await page
      .getByRole("button", { name: "Add provider", exact: true })
      .first()
      .click();
    const picker = page.getByRole("dialog", {
      name: "Add provider",
      exact: true,
    });
    await picker.getByRole("button", { name, exact: true }).click();
    await expect(picker).toHaveCount(0);
  };
  await page.goto(appPath("/login"));
  await page.getByLabel("Email address").fill("browser-test@example.com");
  await page.getByLabel("Password").fill("Isolated-browser-test-password-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/providers/);
  const authCookie = (await context.cookies()).find(
    (c) => c.name === "emailsystem_session",
  );
  expect(authCookie?.path).toBe(process.env.NEXT_PUBLIC_BASE_PATH || "/");
  await expect(page.getByText("No providers yet")).toBeVisible();
  await page
    .getByRole("button", { name: "Sending safety", exact: true })
    .click();
  await expect(
    page.getByLabel("Account daily budget", { exact: true }),
  ).toHaveValue("10000");
  await page.getByLabel("Account daily budget", { exact: true }).fill("12000");
  await page
    .getByRole("button", { name: "Save safety settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await context.request.get(appPath("/api/safety"))).json())
      .accountDaily,
  ).toBe(12000);
  for (const [provider, credential] of [
    ["Resend", "API key"],
    ["Amazon SES", "Access Key ID"],
    ["Mailgun", "Sending API key"],
    ["SendGrid", "API key"],
    ["Brevo", "API key"],
    ["Postmark", "Server token"],
    ["Mailjet", "Public API key"],
    ["SMTP2GO", "API key"],
    ["Elastic Email", "API key (SendHttp)"],
  ]) {
    await chooseProvider(provider);
    const dialog = page.getByRole("dialog");
    // Required labels include the MUI asterisk. Restrict matching to inputs so
    // credential-help links with descriptive aria-labels cannot collide.
    const input = (label: string) =>
      dialog.getByLabel(label).and(dialog.locator("input"));
    await expect(input(credential)).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: new RegExp("Where do I get") }).first(),
    ).toHaveAttribute("href", /^https:/);
    await expect(dialog.getByLabel("SMTP hostname")).toHaveCount(0);
    await dialog.getByRole("button", { name: "SMTP", exact: true }).click();
    if (provider === "Brevo") {
      await expect(input("SMTP key")).toBeVisible();
      await expect(input("API key")).toHaveCount(0);
    }
    if (provider === "Postmark") {
      await expect(input("Stream SMTP access key")).toBeVisible();
      await dialog.getByLabel("SMTP credential type").click();
      await page
        .getByRole("option", { name: "Server token as username and password" })
        .click();
      await expect(input("Server token")).toBeVisible();
      await expect(input("Stream SMTP access key")).toHaveCount(0);
      await dialog.getByLabel("Message Stream type").click();
      await page
        .getByRole("option", { name: "Transactional — test only" })
        .click();
      await expect(input("Message Stream ID")).toHaveValue("outbound");
      await expect(
        dialog.getByText(/Campaigns require a Broadcast stream/),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "test-results/postmark-credentials-mobile.png",
        animations: "disabled",
      });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await dialog
      .getByRole("button", { name: "Sending limits and webhooks" })
      .click();
    await expect(dialog.getByLabel("Port and security")).toBeVisible();
    await expect(
      dialog.getByLabel("Connection timeout (milliseconds)"),
    ).toBeVisible();
    if (provider === "Mailjet") {
      await dialog.getByLabel("Port and security").click();
      await expect(
        page.getByRole("option", { name: "588 · STARTTLS", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("option", { name: "465 · Implicit TLS", exact: true })
        .click();
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await chooseProvider("Custom SMTP");
  await expect(page.getByLabel("SMTP hostname")).toBeVisible();
  await page
    .getByRole("button", { name: "Sending limits and webhooks" })
    .click();
  await expect(page.getByLabel("Security", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await chooseProvider("Development Mock");
  await page.getByLabel("Connection name").fill("Browser verification");
  await page.getByLabel("Verification sender email").fill("invalid-address");
  await page
    .getByRole("button", { name: "Save & Verify", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/email/i);
  await page.getByLabel("Verification sender email").fill("sender@example.com");
  await page
    .getByRole("button", { name: "Save & Verify", exact: true })
    .click();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  const providers = await (
    await context.request.get(appPath("/api/providers"))
  ).json();
  expect(providers).toHaveLength(1);
  expect(providers[0]).not.toHaveProperty("credentials");
  await page.getByRole("button", { name: "Senders", exact: true }).click();
  const sendersDialog = page.getByRole("dialog", {
    name: "Domains & senders",
    exact: true,
  });
  await expect(
    sendersDialog.getByText("example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    sendersDialog.getByText("sender@example.com", { exact: true }),
  ).toBeVisible();
  await sendersDialog
    .getByRole("button", { name: "Done", exact: true })
    .click();
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
  await page.screenshot({
    path: "test-results/provider-connected.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Link settings", exact: true })
    .click();
  const linksDialog = page.getByRole("dialog", {
    name: "Links & tracking",
    exact: true,
  });
  await expect(
    linksDialog.getByLabel("Track clicks by default"),
  ).not.toBeChecked();
  await expect(
    linksDialog.getByText("Click tracking is optional.", { exact: false }),
  ).toBeVisible();
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(linksDialog).toBeVisible();
    await expect(
      linksDialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: `test-results/ux-review/tracking-${width}.jpg`,
      fullPage: true,
      quality: 80,
    });
  }
  await linksDialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto(appPath("/blast"));
  await page.getByLabel("Recipient file").setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "email\none@example.net\none@example.net\ntwo@example.net\nbad\n",
    ),
  });
  await expect(page.getByText("1 duplicate", { exact: true })).toBeVisible();
  // Failed validation is visible beside the action, even below the composer.
  await page
    .getByRole("button", { name: "Run pre-flight", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Pre-flight", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send campaign", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Campaign name").fill("Browser campaign");
  await page.getByLabel("Subject").fill("Browser verification");
  await page
    .getByRole("textbox", { name: "Email body", exact: true })
    .fill("A rich text message");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Underline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Underline", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("HTML file").setInputFiles({
    name: "message.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<html><head><style>@media(max-width:480px){td{padding:12px}}</style></head><body><table width="100%"><tr><td><h1>Delivery check</h1><p>Preserved HTML layout.</p><a href="https://example.com/collection">Explore the collection</a></td></tr></table><script>throw Error("unsafe")</script></body></html>',
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
  await page.getByText("More options", { exact: true }).click();
  await page.getByLabel("Track clicks", { exact: true }).check();
  await page.getByText("More options", { exact: true }).click();
  await page.getByLabel("Subject").fill("Updated browser verification");
  await expect(
    page.getByRole("button", { name: "Send campaign", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Ready to send", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Run pre-flight", exact: true })
    .click();
  await expect(page.getByText("Ready to send", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/blast-preflight.png",
    fullPage: true,
    animations: "disabled",
  });
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
        await context.request.get(appPath("/api/campaigns/" + campaignId))
      ).json();
      return s.counts.DELIVERED;
    })
    .toBe(2);
  await page.screenshot({
    path: "test-results/activity-delivered.png",
    fullPage: true,
    animations: "disabled",
  });
  const { db } = await import("@emailsystem/db");
  const tracked = await db.trackingLink.findFirstOrThrow({
    where: { campaignId },
  });
  const visited = await context.request.get(appPath(`/r/${tracked.token}`), {
    headers: {
      "User-Agent": "Proofpoint scanner",
    },
    maxRedirects: 0,
  });
  expect(visited.status()).toBe(302);
  expect(visited.headers().location).toBe("https://example.com/collection");
  const visitSummary = await (
    await context.request.get(appPath(`/api/campaigns/${campaignId}`))
  ).json();
  expect(visitSummary.tracking.rawVisits).toBe(1);
  expect(visitSummary.tracking.likelyAutomated).toBe(1);
  expect(visitSummary.counts.DELIVERED).toBe(2);
  await db.$disconnect();
  const exported = await context.request.get(
    appPath(`/api/campaigns/${campaignId}/export`),
  );
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toContain("DELIVERED");
  const form = new FormData();
  form.set(
    "paste",
    Array.from({ length: 40 }, (_, i) => `queued${i}@example.net`).join("\n"),
  );
  const imported = await (
    await context.request.post(appPath("/api/imports"), {
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
    await context.request.post(appPath("/api/campaigns"), {
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
  await page.goto(appPath("/activity?campaignId=" + started.id));
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
    await (
      await context.request.get(appPath("/api/campaigns/" + started.id))
    ).json()
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
            await context.request.get(appPath("/api/campaigns/" + started.id))
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
        await context.request.get(appPath("/api/campaigns/" + started.id))
      ).json();
      return c.state;
    })
    .toBe("CANCELLED");
  for (const width of [390, 430, 768, 1366, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/providers", "/blast", "/activity"]) {
      await page.goto(
        appPath(
          route === "/activity" ? route + "?campaignId=" + campaignId : route,
        ),
      );
      if (route === "/activity")
        await expect(
          page.getByRole("log", { name: "Campaign events" }),
        ).toContainText("DELIVERED");
      else if (route === "/providers")
        await expect(
          page.getByText("Browser verification", { exact: true }),
        ).toBeVisible();
      else
        await expect(page.getByLabel("Sender identity")).toContainText(
          "sender@example.com",
        );
      if (route === "/blast") {
        await page.getByLabel("Recipient import").click();
        await page
          .getByRole("option", {
            name: "contacts.csv · 2 recipients",
            exact: true,
          })
          .click();
        await page.getByLabel("Campaign name").fill("September update");
        await page.getByLabel("Subject").fill("Something good is on the way");
        await page
          .getByLabel("Preview text")
          .fill("A quick look at what’s new this month.");
        await page
          .getByRole("textbox", { name: "Email body", exact: true })
          .fill(
            "Hello there,\nWe’ve been working on a few things we think you’ll love. Here’s a quick look at what’s new this month.\nThanks for being part of the journey.",
          );
        await page
          .getByRole("button", { name: "Run pre-flight", exact: true })
          .click();
        await expect(
          page.getByText("Ready to send", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Send campaign", exact: true }),
        ).toBeEnabled();
        // Pre-flight readiness and iframe painting are separate events. Check the
        // actual message, then bring the frame into view before capturing it.
        await expect(
          page
            .frameLocator('iframe[title="desktop email preview"]')
            .locator("body"),
        ).toContainText("Hello there,");
        await page
          .locator('iframe[title="desktop email preview"]')
          .scrollIntoViewIfNeeded();
        if (width === 390 || width === 1366)
          await review(`preview-${width}`, false, false);
      }
      if (width === 390 || width === 1366) {
        // A phone has no fixed sidebar; retain the painted preview viewport.
        await review(
          `${route.slice(1)}-${width}`,
          true,
          route !== "/blast" || width !== 390,
        );
      }
      if (route === "/providers") {
        if (width === 390 || width === 1366) {
          await page
            .getByRole("button", { name: "Add provider", exact: true })
            .first()
            .click();
          const picker = page.getByRole("dialog", {
            name: "Add provider",
            exact: true,
          });
          await expect(picker).toBeVisible();
          await review(`provider-picker-${width}`, false);
          await picker
            .getByRole("button", { name: "Resend", exact: true })
            .click();
          await expect(picker).toHaveCount(0);
          const providerForm = page.getByRole("dialog", {
            name: "Connect Resend",
            exact: true,
          });
          await expect(
            providerForm.getByLabel("Connection name"),
          ).toBeVisible();
          await review(`provider-dialog-${width}`, false);
          const bounds = await providerForm
            .getByRole("button", { name: "Save & Verify", exact: true })
            .boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
          expect(
            await providerForm.evaluate(
              (el) => el.scrollWidth <= el.clientWidth + 2,
            ),
          ).toBe(true);
          await providerForm
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        }
        await page
          .getByRole("button", { name: "Sending safety", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Sending safety",
          exact: true,
        });
        await expect(
          dialog.getByLabel("Account daily budget", { exact: true }),
        ).toHaveValue("12000");
        await dialog
          .getByRole("button", { name: "Automatic safety pauses", exact: true })
          .click();
        await expect(
          dialog.getByLabel("Complaint threshold (%)", { exact: true }),
        ).toBeVisible();
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/safety-dialog-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      if (route === "/activity")
        await expect(
          page.getByLabel("Sending safety usage", { exact: true }),
        ).toContainText("Account · 24h");
      await page.screenshot({
        path: `test-results/${route.slice(1)}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Providers", exact: true }).click();
  await expect(page).toHaveURL(/providers/);
  await expect(
    page.getByRole("link", { name: "Blast", exact: true }),
  ).not.toBeVisible();
  await context.clearCookies();
  await page.goto(appPath("/login"));
  await review("login-390");
  await page.setViewportSize({ width: 1366, height: 900 });
  await review("login-1366");
  expect(errors).toEqual([]);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    mkdirSync("test-results/ux-review", { recursive: true });
    await page.screenshot({
      path: "test-results/ux-review/failure.jpg",
      type: "jpeg",
      quality: 75,
      animations: "disabled",
    });
    console.log(
      "UX_ACCESSIBILITY",
      (await page.locator("body").ariaSnapshot()).slice(0, 12000),
    );
  }
});
