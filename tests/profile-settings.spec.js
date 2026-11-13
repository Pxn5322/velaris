// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Profile settings: a signed-in user sets their Supabase avatar_url.
 *
 * The API and Supabase Auth are intercepted, so the journey checks the
 * browser contract: the control sends `data.avatar_url` to Supabase, updates
 * the identity block immediately, and rejects unsafe URLs before any request.
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

async function seedSession(page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(SESSION)],
  );
}

async function openProfile(page) {
  await page.goto("/admin");
  await expect(page.getByTestId("nav-identity")).toContainText("Acme Admin");
  await page.getByTestId("nav-profile").click();
  await expect(page.getByTestId("profile-settings")).toBeVisible();
}

test.describe("profile settings", () => {
  test("saves and clears the Supabase avatar URL", async ({ page }) => {
    let updateBody = null;
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/auth/v1/user*", async (route) => {
      if (route.request().method() !== "PUT") {
        return route.fulfill(json({ message: "Method not allowed" }, 405));
      }
      updateBody = route.request().postDataJSON();
      return route.fulfill(json({ id: "sub-e2e" }));
    });
    await page.route("https://cdn.example.test/avatar.png", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />',
      }),
    );

    await openProfile(page);
    await page
      .getByTestId("profile-avatar-url")
      .fill("https://cdn.example.test/avatar.png");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-settings")).toBeHidden();
    await expect(page.getByTestId("nav-avatar-image")).toHaveAttribute(
      "src",
      "https://cdn.example.test/avatar.png",
    );
    expect(updateBody).toEqual({
      data: { avatar_url: "https://cdn.example.test/avatar.png" },
    });

    await page.getByTestId("nav-profile").click();
    await page.getByTestId("profile-avatar-url").fill("");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-settings")).toBeHidden();
    await expect(page.getByTestId("nav-avatar-initials")).toHaveText("AA");
    expect(updateBody).toEqual({ data: { avatar_url: null } });
  });

  test("rejects a non-https avatar URL before saving", async ({ page }) => {
    let putCalls = 0;
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/auth/v1/user*", (route) => {
      putCalls += 1;
      return route.fulfill(json({ id: "sub-e2e" }));
    });

    await openProfile(page);
    await page
      .getByTestId("profile-avatar-url")
      .fill("http://cdn.example.test/avatar.png");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-error")).toHaveText(
      "Avatar URL must start with https://.",
    );
    await expect(page.getByTestId("profile-settings")).toBeVisible();
    await expect(page.getByTestId("nav-avatar-initials")).toHaveText("AA");
    expect(putCalls).toBe(0);
  });
});
