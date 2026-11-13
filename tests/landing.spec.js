// @ts-check
import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/**
 * E2E journey J-01: public landing page.
 *
 * Maps to AC-F01-1 (TST-AC-F01-1): "Given an anonymous visitor, when `/`
 * loads, then all required marketing sections and primary CTAs render."
 *
 * Selectors use the real `id` attributes and heading text in
 * apps/web/src/components/landing/*. The app under test is the production
 * bundle served by the Playwright webServer, not the retired prototype.
 */

test.describe("landing page (AC-F01-1)", () => {
  test("renders the hero headline and primary CTAs", async ({ page }) => {
    await page.goto("/");

    // Hero headline from LandingHero.tsx.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Intelligent Customer Operations",
    );

    // Hero primary CTA has the stable id `trigger-motion` (LandingHero.tsx).
    // "Start Free" text also appears in the header and the auth modal, so we
    // address the hero button by id to avoid a strict-mode violation.
    await expect(page.locator("#trigger-motion")).toBeVisible();
    await expect(page.getByRole("link", { name: /View Demo/i })).toBeVisible();

    // NFR-08: the public landing page is the first critical journey.
    await expectNoSeriousA11yViolations(page, "landing hero");
  });

  test("every keyboard stop shows a visible focus ring (NFR-08)", async ({
    page,
  }) => {
    await page.goto("/");

    // The first stops are the logo link, the theme and menu buttons and the
    // header calls to action. A ring that the stylesheet removed, without a
    // replacement, leaves a keyboard user with no idea where they are.
    const stops = [];
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          const style = element ? getComputedStyle(element) : null;
          return {
            label: `${element?.tagName ?? "none"} ${
              (element?.textContent ?? "").trim().slice(0, 20) ||
              element?.getAttribute("aria-label") ||
              ""
            }`.trim(),
            outlineStyle: style?.outlineStyle ?? "none",
            outlineWidth: style?.outlineWidth ?? "0px",
          };
        }),
      );
    }

    for (const stop of stops) {
      // Chrome reports its own ring as `auto`; the design system ring is
      // `solid`. Either is visible, and `none` is the failure this test
      // exists to catch.
      expect(stop.outlineStyle, `${stop.label}: outline style`).not.toBe(
        "none",
      );
      expect(
        Number.parseFloat(stop.outlineWidth),
        `${stop.label}: outline width`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  test("renders every required marketing section anchor", async ({ page }) => {
    await page.goto("/");

    // Each section is addressed by a stable id in its landing component.
    for (const id of [
      "product",
      "solutions",
      "security",
      "telemetry",
      "pricing",
      "resources",
    ]) {
      await expect(
        page.locator(`section#${id}`),
        `section #${id} should render`,
      ).toHaveCount(1);
    }
  });

  test("header exposes Sign In and Start Free entry points", async ({
    page,
  }) => {
    await page.goto("/");

    // Both auth CTAs live in the fixed header (LandingHeader.tsx). The signup
    // CTA label is "Start Free", also used by the hero primary button, so we
    // scope to the header container and match the first (header) instance.
    const header = page.locator("header");
    await expect(header.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(
      header.getByRole("button", { name: /Start Free/ }),
    ).toBeVisible();
  });

  test("sign-in applies the server role and identity together", async ({
    page,
  }) => {
    await page.route("**/auth/v1/token*", (route) =>
      route.fulfill(
        json({
          access_token: "e2e-access-token",
          refresh_token: "e2e-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { email: "admin@acme.test" },
        }),
      ),
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(
        json({
          identity: {
            provider: "supabase",
            subject: "sub-e2e",
            email: "admin@acme.test",
          },
          tenantContext: {
            userId: "user-1",
            displayName: "Acme Admin",
            tenants: [
              {
                tenantId: "tenant-a",
                slug: "acme",
                name: "Acme",
                membershipId: "membership-1",
              },
            ],
          },
          role: "R-tenant-admin",
        }),
      ),
    );

    await page.goto("/?signin=1");
    await page.getByTestId("sign-in-email").fill("admin@acme.test");
    await page.getByTestId("sign-in-password").fill("correct-horse-battery");
    await page.getByTestId("sign-in-submit").click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("nav-identity")).toContainText("Acme Admin");
    await expect(page.getByTestId("nav-role")).toHaveText("Tenant Admin");
    await expect(page.getByTestId("nav-avatar-initials")).toHaveText("AA");
  });

  test("Start Free opens the tenant registration form (F-01)", async ({
    page,
  }) => {
    await page.goto("/");

    const header = page.locator("header");
    await header.getByRole("button", { name: /Start Free/ }).click();

    // Registration asks for the workspace the new tenant will administer.
    await expect(
      page.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();
    await expect(page.getByTestId("sign-up-workspace")).toBeVisible();
    await expect(page.getByTestId("sign-in-submit")).toHaveText(
      "Create workspace",
    );

    // The Sign In entry point still opens the plain sign-in form.
    await page.getByLabel("Close dialog").click();
    await header.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByTestId("sign-up-workspace")).toHaveCount(0);
    await expect(page.getByTestId("sign-in-submit")).toHaveText(
      "Continue to Platform",
    );
  });
});
