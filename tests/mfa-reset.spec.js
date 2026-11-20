// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Mandatory authenticator enrollment after a privileged MFA reset
 * (T6.09, AC-F02-4).
 *
 * The session read reports `mfaResetRequired` and every other API route
 * answers `403 MFA_RESET_REQUIRED`. The journey checks the browser contract:
 * the app opens the authenticator dialog without a click, the dialog cannot be
 * dismissed, and a verified factor refreshes the session so the gate closes.
 */

const SESSION_KEY = "velaris.auth.session.v1";
const SESSION = {
  accessToken: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "admin@acme.test",
};

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-e2e",
    email: "admin@acme.test",
    displayName: "Acme Admin",
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
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test.describe("MFA reset", () => {
  test("requires a new authenticator and refreshes the cleared session", async ({
    page,
  }) => {
    let mfaResetRequired = true;
    let sessionReads = 0;
    let enrollments = 0;

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(SESSION)],
    );
    await page.route("**/auth/session*", (route) => {
      sessionReads += 1;
      return route.fulfill(json({ ...sessionResponse, mfaResetRequired }));
    });
    await page.route("**/auth/v1/factors", (route) => {
      enrollments += 1;
      return route.fulfill(
        json({
          id: "factor-new",
          totp: {
            qr_code: null,
            secret: "NEWFACTORSECRET",
            uri: "otpauth://totp/VELARIS",
          },
        }),
      );
    });
    await page.route("**/auth/v1/factors/factor-new/challenge", (route) =>
      route.fulfill(json({ id: "challenge-new" })),
    );
    await page.route("**/auth/v1/factors/factor-new/verify", (route) => {
      mfaResetRequired = false;
      return route.fulfill(
        json({
          access_token: "aal2-access-token",
          refresh_token: "aal2-refresh-token",
          expires_in: 3600,
          user: { email: "admin@acme.test" },
        }),
      );
    });

    await page.goto("/admin");

    const dialog = page.getByTestId("mfa-settings");
    await expect(dialog).toHaveAttribute("data-stage", "enroll");
    await expect(dialog).toHaveAttribute("data-required", "true");
    await expect(dialog).toContainText(
      "A privileged reset removed your authenticator",
    );
    await expect(dialog).toContainText("NEWFACTORSECRET");
    await expect(page.getByTestId("mfa-settings-close")).toHaveCount(0);
    await expect(page.getByTestId("mfa-enroll-cancel")).toHaveText("Sign out");
    expect(enrollments).toBe(1);

    await page.getByTestId("mfa-new-code").fill("123456");
    await page.getByTestId("mfa-new-submit").click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("nav-identity")).toContainText("Acme Admin");
    expect(sessionReads).toBeGreaterThanOrEqual(2);
  });

  test("closes the gate without waiting for the factor list read", async ({
    page,
  }) => {
    let mfaResetRequired = true;

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(SESSION)],
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json({ ...sessionResponse, mfaResetRequired })),
    );
    await page.route("**/auth/v1/factors", (route) =>
      route.fulfill(
        json({
          id: "factor-new",
          totp: {
            qr_code: null,
            secret: "NEWFACTORSECRET",
            uri: "otpauth://totp/VELARIS",
          },
        }),
      ),
    );
    await page.route("**/auth/v1/factors/factor-new/challenge", (route) =>
      route.fulfill(json({ id: "challenge-new" })),
    );
    await page.route("**/auth/v1/factors/factor-new/verify", (route) => {
      mfaResetRequired = false;
      return route.fulfill(
        json({
          access_token: "aal2-access-token",
          refresh_token: "aal2-refresh-token",
          expires_in: 3600,
          user: { email: "admin@acme.test" },
        }),
      );
    });
    // The panel refresh reads the factor list from the provider. That read
    // settles the gate's state, not the reset, so a slow provider must not
    // hold the dialog open.
    await page.route("**/auth/v1/user", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return route.fulfill(json({ factors: [] }));
    });

    await page.goto("/admin");

    const dialog = page.getByTestId("mfa-settings");
    await expect(dialog).toHaveAttribute("data-stage", "enroll");
    await page.getByTestId("mfa-new-code").fill("123456");
    await page.getByTestId("mfa-new-submit").click();

    await expect(dialog).toHaveCount(0);
  });
});
