// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Mandatory password change after a required reset (T6.08, D-58).
 *
 * GET /auth/session reports `passwordResetRequired` and every other API route
 * answers `403 PASSWORD_RESET_REQUIRED` until POST /auth/password succeeds.
 * The journey checks the browser contract: the app opens a non-dismissible
 * password dialog without a click, shows the server's policy refusal, and a
 * successful change ends the session so the user signs in with the new
 * password (the change advances the access-token cutoff).
 */

const SESSION_KEY = "velaris.auth.session.v1";
const SESSION = {
  accessToken: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "admin@acme.test",
};

const CURRENT_PASSWORD = "Old-passphrase-12";
const NEW_PASSWORD = "correct-horse-battery-staple-42";

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-e2e",
    email: "admin@acme.test",
    displayName: "Acme Admin",
  },
  // The API hides the workspace context while the password reset is pending.
  tenantContext: null,
  role: null,
  passwordResetRequired: true,
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test.describe("Password reset", () => {
  test("signs a flagged account into the workspace so the gate opens", async ({
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
      route.fulfill(json(sessionResponse)),
    );

    await page.goto("/?signin=1");
    await page.getByTestId("sign-in-email").fill("admin@acme.test");
    await page.getByTestId("sign-in-password").fill(CURRENT_PASSWORD);
    await page.getByTestId("sign-in-submit").click();

    // The role is hidden while the reset is pending, so the sign-in form must
    // not answer "no workspace access": it routes into the workspace, where
    // the workspace gate asks for the new password.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("password-reset")).toBeVisible();
    await expect(page.getByTestId("sign-in-error")).toHaveCount(0);
  });

  test("requires a new password and signs out after the change", async ({
    page,
  }) => {
    let changes = 0;

    // Seed once per tab: the sign-out navigation is a full page load, and a
    // plain init script would put the session back on the landing page.
    await page.addInitScript(
      ([key, value]) => {
        if (window.sessionStorage.getItem("e2e-seeded")) return;
        window.sessionStorage.setItem("e2e-seeded", "1");
        window.localStorage.setItem(key, value);
      },
      [SESSION_KEY, JSON.stringify(SESSION)],
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/auth/password", (route) => {
      changes += 1;
      const body = route.request().postDataJSON();
      if (body?.currentPassword !== CURRENT_PASSWORD) {
        return route.fulfill(
          json(
            {
              code: "CURRENT_PASSWORD_INVALID",
              message: "The current password is not valid",
            },
            403,
          ),
        );
      }
      return route.fulfill({ status: 204, body: "" });
    });
    await page.route("**/auth/signout", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );

    await page.goto("/admin");

    const dialog = page.getByTestId("password-reset");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-required", "true");
    await expect(dialog).toContainText("must set a new password");
    await expect(page.getByTestId("password-reset-close")).toHaveCount(0);
    await expect(page.getByTestId("password-reset-signout")).toBeVisible();

    await page.getByTestId("password-reset-current").fill("wrong-password");
    await page.getByTestId("password-reset-new").fill(NEW_PASSWORD);
    await page.getByTestId("password-reset-submit").click();

    await expect(page.getByTestId("password-reset-error")).toContainText(
      "current password is not correct",
    );
    expect(changes).toBe(1);
    await expect(dialog).toBeVisible();

    await page.getByTestId("password-reset-current").fill(CURRENT_PASSWORD);
    await page.getByTestId("password-reset-submit").click();

    expect(changes).toBe(2);
    await page.waitForURL(/\/\?signin=1/);
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SESSION_KEY,
    );
    expect(stored).toBeNull();
  });
});
