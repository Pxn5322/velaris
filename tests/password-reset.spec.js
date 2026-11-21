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
 * password (the change advances the access-token cutoff). It also checks
 * that both public sign-in pages and the recovery callback route a flagged
 * account into the gate, and that the callback sends a cleared account to its
 * role route.
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

const agentSessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-e2e",
    email: "agent@acme.test",
    displayName: "Acme Agent",
  },
  tenantContext: { displayName: "Acme" },
  role: "R-agent",
  passwordResetRequired: false,
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/**
 * Sign in at a public sign-in page as an account whose role the API hides
 * behind `passwordResetRequired`, with the standard mocked auth and session.
 */
async function signInAsFlagged(page, path, email) {
  await page.route("**/auth/v1/token*", (route) =>
    route.fulfill(
      json({
        access_token: "e2e-access-token",
        refresh_token: "e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { email },
      }),
    ),
  );
  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionResponse)),
  );

  await page.goto(path);
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill(CURRENT_PASSWORD);
  await page.getByTestId("sign-in-submit").click();
}

/**
 * Open a recovery link, set the new password and continue to the workspace.
 * The link form itself belongs to tests/auth-recovery.spec.js; this helper only
 * reaches the Continue step so the cases below can check where it lands.
 */
async function continueFromRecoveryLink(page) {
  // The password update goes to the cross-origin provider, so the mocked
  // answer must carry CORS headers or the browser reports a network error.
  await page.route("**/auth/v1/user*", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: "sub-e2e" }),
    }),
  );
  await page.goto(
    "/auth/callback#access_token=e2e-link-token&refresh_token=e2e-link-refresh&expires_at=4102444800&type=recovery",
  );

  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  expect(page.url()).not.toContain("access_token");

  await page.getByTestId("new-password").fill(NEW_PASSWORD);
  await page.getByTestId("confirm-password").fill(NEW_PASSWORD);
  await page.getByTestId("update-password").click();

  await page.getByRole("button", { name: "Continue to workspace" }).click();
}

test.describe("Password reset", () => {
  test("signs a flagged account into the workspace so the gate opens", async ({
    page,
  }) => {
    await signInAsFlagged(page, "/?signin=1", "admin@acme.test");

    // The role is hidden while the reset is pending, so the sign-in form must
    // not answer "no workspace access": it routes into the workspace, where
    // the gate asks for the new password.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("password-reset")).toBeVisible();
    await expect(page.getByTestId("sign-in-error")).toHaveCount(0);
  });

  test("routes a flagged portal sign-in into the gate", async ({ page }) => {
    await signInAsFlagged(page, "/portal/sign-in", "customer@acme.test");

    // The portal form used to answer "no portal access" for the same hidden
    // role. The flagged account now enters the workspace and the gate opens.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("password-reset")).toBeVisible();
    await expect(page.getByTestId("sign-in-error")).toHaveCount(0);
  });

  test("routes a flagged profile from a recovery link into the gate", async ({
    page,
  }) => {
    // A recovery link signs the browser in from the URL fragment. The password
    // it sets is not proof that the account is clean: the API still decides,
    // and this profile keeps asking for the workspace reset.
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );

    // The callback used to push "/" for a role-less profile, so the flagged
    // account was dropped back on the landing page with no way to the reset.
    await continueFromRecoveryLink(page);

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("password-reset")).toBeVisible();
  });

  test("routes a cleared profile from a recovery link by role", async ({
    page,
  }) => {
    // The same link, after the API no longer flags the account: Continue must
    // answer by role. An agent is the useful case, because /admin would hide a
    // callback that still fell back to the reset route.
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(agentSessionResponse)),
    );

    await continueFromRecoveryLink(page);

    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByTestId("password-reset")).toHaveCount(0);
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
