// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Profile editing from the identity menu.
 *
 * The API is intercepted, so the journey checks the browser contract:
 * clicking the identity opens a two-item menu, the name dialog sends only
 * displayName, and the photo dialog uploads a local image as a bounded data
 * URL instead of asking for a remote URL.
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

async function openAccountMenu(page) {
  await page.goto("/admin");
  await expect(page.getByTestId("nav-identity")).toContainText("Acme Admin");
  await page.getByTestId("nav-identity").click();
  await expect(page.getByTestId("account-menu-desktop")).toBeVisible();
}

async function routeProfile(page, bodies) {
  await page.route("**/auth/profile", (route) => {
    if (route.request().method() !== "PATCH") {
      return route.fulfill(json({ message: "Method not allowed" }, 405));
    }
    const body = route.request().postDataJSON();
    bodies.push(body);
    return route.fulfill(
      json({
        displayName: body.displayName ?? "Acme Admin",
        avatarUrl: body.avatarDataUrl ?? null,
      }),
    );
  });
}

test.describe("profile settings", () => {
  test("opens the account menu instead of a separate profile button", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );

    await page.goto("/admin");
    await expect(page.getByTestId("nav-profile")).toHaveCount(0);

    await page.getByTestId("nav-identity").click();
    await expect(page.getByTestId("account-menu-photo-desktop")).toBeVisible();
    await expect(page.getByTestId("account-menu-name-desktop")).toBeVisible();
  });

  test("renames the account from the identity menu", async ({ page }) => {
    const bodies = [];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await routeProfile(page, bodies);

    await openAccountMenu(page);
    await page.getByTestId("account-menu-name-desktop").click();
    await expect(page.getByTestId("profile-settings")).toHaveAttribute(
      "data-section",
      "name",
    );
    await page.getByTestId("profile-display-name").fill("Support Lead");
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-settings")).toBeHidden();
    await expect(page.getByTestId("nav-identity")).toContainText(
      "Support Lead",
    );
    expect(bodies).toEqual([{ displayName: "Support Lead" }]);
  });

  test("uploads and removes a local profile photo", async ({ page }) => {
    const bodies = [];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await routeProfile(page, bodies);

    await openAccountMenu(page);
    await page.getByTestId("account-menu-photo-desktop").click();
    await page.getByTestId("profile-avatar-file").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(
      page.getByTestId("profile-avatar-preview").locator("img"),
    ).toBeVisible();
    await page.getByTestId("profile-save").click();

    await expect(page.getByTestId("profile-settings")).toBeHidden();
    await expect(page.getByTestId("nav-avatar-image")).toHaveAttribute(
      "src",
      /^data:image\/webp;base64,/,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0].avatarDataUrl).toMatch(/^data:image\/webp;base64,/);

    await page.getByTestId("nav-identity").click();
    await page.getByTestId("account-menu-photo-desktop").click();
    await page.getByTestId("profile-remove-photo").click();

    await expect(page.getByTestId("profile-settings")).toBeHidden();
    await expect(page.getByTestId("nav-avatar-initials")).toHaveText("AA");
    expect(bodies[1]).toEqual({ avatarDataUrl: null });
  });

  test("rejects a non-image file before any request", async ({ page }) => {
    const bodies = [];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await routeProfile(page, bodies);

    await openAccountMenu(page);
    await page.getByTestId("account-menu-photo-desktop").click();
    await page.getByTestId("profile-avatar-file").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });

    await expect(page.getByTestId("profile-error")).toHaveText(
      "Choose a PNG, JPEG or WebP image.",
    );
    expect(bodies).toHaveLength(0);
  });
});
