import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { normalizeEmail } from "@emailsystem/email";

for (const name of ["newsletter", "announcement"])
  for (const width of [390, 1366]) {
    test(`${name} HTML fidelity at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("https://images.example.com/**", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220"><rect width="600" height="220" fill="#e4d8c8"/><rect x="60" y="40" width="160" height="140" rx="12" fill="#59756d"/><circle cx="390" cy="110" r="72" fill="#bd8567"/></svg>',
        }),
      );
      const original = readFileSync(`tests/fixtures/html/${name}.html`, "utf8");
      const dimensions = () =>
        page.locator("table,td,h1,h2,p,a,img").evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect(),
              style = getComputedStyle(n);
            return {
              tag: n.tagName,
              text:
                n.tagName === "IMG"
                  ? n.getAttribute("alt")
                  : n.textContent?.replace(/\s+/g, " ").trim(),
              box: [r.x, r.y, r.width, r.height],
              color: style.color,
              background: style.backgroundColor,
              fontSize: style.fontSize,
              padding: style.padding,
              borderRadius: style.borderRadius,
              lineHeight: style.lineHeight,
            };
          }),
        );
      mkdirSync("test-results/ux-review", { recursive: true });
      await page.setContent(original, { waitUntil: "networkidle" });
      const before = await dimensions();
      await page.screenshot({
        path: `test-results/ux-review/fidelity-${name}-original-${width}.jpg`,
        quality: 80,
        fullPage: true,
      });
      await page.setContent(normalizeEmail(original).html, {
        waitUntil: "networkidle",
      });
      const after = await dimensions();
      expect(after).toHaveLength(before.length);
      for (let index = 0; index < before.length; index++) {
        const { box: a, ...appearanceA } = before[index],
          { box: b, ...appearanceB } = after[index];
        expect(appearanceB).toEqual(appearanceA);
        for (let axis = 0; axis < 4; axis++)
          expect(Math.abs(a[axis] - b[axis])).toBeLessThanOrEqual(1);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `test-results/ux-review/fidelity-${name}-normalized-${width}.jpg`,
        quality: 80,
        fullPage: true,
      });
    });
  }
