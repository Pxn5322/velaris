// @ts-check
import { test, expect } from "@playwright/test";

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
