// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Tenant administrator user directory (F-03, AC-F03-1, AC-F03-2).
 *
 * Every API call is intercepted with page.route: the CI runner has no
 * database. The session response carries the server-resolved role, so the
 * route guard and the panel read the same authority the real API provides.
 *
 * Covered:
 * - only members of the signed-in tenant are listed; sample cross-tenant
 *   users from the old hardcoded table never appear
 * - an invitation posts the tenant id, email, role and invite flag
 * - a role change, suspension and removal reach the tenant-scoped routes
 * - a signed-out visitor and a customer are redirected to /?signin=1
 *   instead of seeing an administrator page
 */

const SESSION_KEY = "velaris.auth.session.v1";

const session = {
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

const members = [
  {
    membershipId: "membership-1",
    userId: "user-1",
    email: "admin@acme.test",
    displayName: "Acme Admin",
    status: "ACTIVE",
    roles: ["R-tenant-admin"],
  },
  {
    membershipId: "membership-2",
    userId: "user-2",
    email: "agent@acme.test",
    displayName: "Acme Agent",
    status: "ACTIVE",
    roles: ["R-agent"],
  },
];

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function seedSession(page) {
  // Seed the local session once per browser context. A document reload after
  // sign-out must not recreate the session the test just cleared.
  await page.addInitScript(
    ([key, value]) => {
      if (window.sessionStorage.getItem("e2e-admin-seeded") === "1") return;
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem("e2e-admin-seeded", "1");
    },
    [SESSION_KEY, JSON.stringify(session)],
  );
}

async function routeSession(page, body = sessionResponse) {
  await page.route("**/auth/session*", (route) => route.fulfill(json(body)));
}

async function openUserDirectory(page) {
  await page.goto("/admin");
  await page.getByRole("button", { name: "User Directory" }).click();
  await expect(page.getByTestId("tenant-users-panel")).toBeVisible();
}

async function mobileHeaderLayout(page) {
  return page.evaluate(() => {
    const logo = document.querySelector('header a[href="/"]');
    const identity = document.querySelector(
      '[data-testid="nav-identity-mobile"]',
    );
    const name = document.querySelector(
      '[data-testid="nav-identity-mobile-name"]',
    );
    const signOut = document.querySelector(
      '[data-testid="nav-sign-out-mobile"]',
    );
    const menu = document.querySelector('[aria-label="Toggle Navigation"]');
    if (!logo || !identity || !name || !signOut || !menu) {
      throw new Error("The mobile header controls are not rendered");
    }
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      logoRight: logo.getBoundingClientRect().right,
      identityLeft: identity.getBoundingClientRect().left,
      identityRight: identity.getBoundingClientRect().right,
      nameWidth: name.getBoundingClientRect().width,
      nameScrollWidth: name.scrollWidth,
      signOutLeft: signOut.getBoundingClientRect().left,
      signOutRight: signOut.getBoundingClientRect().right,
      menuLeft: menu.getBoundingClientRect().left,
      menuRight: menu.getBoundingClientRect().right,
    };
  });
}

test.describe("tenant administrator user directory (F-03)", () => {
  test("lists only members of the signed-in tenant", async ({ page }) => {
    let listUrl = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/tenants/*/users*", (route) => {
      if (route.request().method() !== "GET") {
        return route.fulfill(json({ message: "Method not allowed" }, 405));
      }
      listUrl = new URL(route.request().url());
      return route.fulfill(json(members));
    });

    await openUserDirectory(page);

    await expect(page.getByTestId("tenant-user-row")).toHaveCount(2);
    await expect(
      page
        .getByTestId("tenant-user-row")
        .filter({ hasText: "agent@acme.test" }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("tenant-users-panel")
        .getByText("Only members of the selected tenant"),
    ).toBeVisible();

    // The tenant id comes from GET /auth/session, not from the URL or input.
    expect(listUrl?.pathname).toBe("/tenants/tenant-a/users");

    // The old hardcoded directory mixed tenants. None of those rows remain.
    await expect(page.getByText("other@globex.test")).toHaveCount(0);
    await expect(page.getByText("marcus@globex.io")).toHaveCount(0);
  });

  test("invites a new user into the tenant with the selected role", async ({
    page,
  }) => {
    let posted = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/tenants/*/users*", (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON();
        return route.fulfill(
          json(
            {
              membershipId: "membership-3",
              userId: "user-3",
              email: posted.email,
              status: "ACTIVE",
              roles: [posted.roleCode],
              invited: true,
            },
            201,
          ),
        );
      }
      return route.fulfill(json(members));
    });

    await openUserDirectory(page);
    await page.getByTestId("tenant-invite-email").fill("new@acme.test");
    await page.getByTestId("tenant-invite-role").selectOption("R-tenant-admin");
    await page.getByTestId("tenant-invite-submit").click();

    await expect(page.getByTestId("tenant-users-notice")).toContainText(
      "Invitation sent to new@acme.test",
    );
    expect(posted).toEqual({
      email: "new@acme.test",
      roleCode: "R-tenant-admin",
      invite: true,
    });
  });

  test("changes a role, suspends and removes a tenant user", async ({
    page,
  }) => {
    const calls = [];
    await seedSession(page);
    await routeSession(page);
    await page.route("**/tenants/*/users*", (route) =>
      route.fulfill(json(members)),
    );
    await page.route("**/tenants/*/memberships/*/roles", (route) => {
      calls.push({
        method: "PUT",
        body: route.request().postDataJSON(),
      });
      return route.fulfill(
        json({
          membershipId: "membership-2",
          tenantId: "tenant-a",
          roleCode: "R-tenant-admin",
        }),
      );
    });
    await page.route("**/tenants/*/memberships/*/status", (route) => {
      calls.push({
        method: "PATCH",
        body: route.request().postDataJSON(),
      });
      return route.fulfill(
        json({
          membershipId: "membership-2",
          tenantId: "tenant-a",
          status: "SUSPENDED",
        }),
      );
    });
    await page.route("**/tenants/*/memberships/*", (route) => {
      calls.push({ method: route.request().method(), body: null });
      return route.fulfill(
        json({
          membershipId: "membership-2",
          tenantId: "tenant-a",
          removed: true,
        }),
      );
    });

    await openUserDirectory(page);
    const agentRow = page
      .getByTestId("tenant-user-row")
      .filter({ hasText: "agent@acme.test" });

    await agentRow.getByRole("button", { name: "Edit role" }).click();
    await agentRow
      .getByTestId("tenant-role-select")
      .selectOption("R-tenant-admin");
    await agentRow.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(() => calls.find((call) => call.method === "PUT")?.body)
      .toEqual({ roleCode: "R-tenant-admin" });

    await agentRow.getByRole("button", { name: "Suspend" }).click();
    await expect
      .poll(() => calls.find((call) => call.method === "PATCH")?.body)
      .toEqual({ status: "SUSPENDED" });

    page.once("dialog", (dialog) => dialog.accept());
    await agentRow.getByRole("button", { name: "Remove" }).click();
    await expect
      .poll(() => calls.some((call) => call.method === "DELETE"))
      .toBe(true);
    await expect(page.getByTestId("tenant-users-notice")).toContainText(
      "agent@acme.test was removed from this tenant",
    );
  });

  test("shows the caller identity and signs out from the administrator page", async ({
    page,
  }) => {
    let signOutAuthorization = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/auth/signout", (route) => {
      signOutAuthorization = route.request().headers()["authorization"];
      return route.fulfill(json({ signedOut: true }));
    });

    await page.goto("/admin");

    await expect(page.getByTestId("nav-identity")).toBeVisible();
    await expect(page.getByTestId("nav-identity")).toContainText("Acme Admin");
    await expect(page.getByTestId("nav-identity")).toContainText(
      "Tenant Admin",
    );
    await expect(page.getByTestId("nav-avatar")).toBeVisible();
    await expect(page.getByTestId("nav-avatar-initials")).toHaveText("AA");

    await page.getByTestId("nav-sign-out").click();

    await expect
      .poll(() => signOutAuthorization)
      .toBe("Bearer e2e-access-token");
    await expect(page).toHaveURL(/\?signin=1/);
    await expect(
      page.getByRole("heading", { name: "Sign In to VELARIS" }),
    ).toBeVisible();
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SESSION_KEY,
    );
    expect(stored).toBeNull();
  });

  test("renders the profile photo from Supabase user metadata", async ({
    page,
  }) => {
    const avatarUrl = "https://cdn.example.test/avatar.png";
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    await seedSession(page);
    await routeSession(page, {
      ...sessionResponse,
      identity: { ...sessionResponse.identity, avatarUrl },
    });
    await page.route(avatarUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: onePixelPng,
      }),
    );

    await page.goto("/admin");

    await expect(page.getByTestId("nav-avatar-image")).toHaveAttribute(
      "src",
      avatarUrl,
    );
    await expect(page.getByTestId("nav-avatar-initials")).toHaveCount(0);
  });

  test("falls back to initials when the profile photo cannot load", async ({
    page,
  }) => {
    const avatarUrl = "https://cdn.example.test/missing-avatar.png";

    await seedSession(page);
    await routeSession(page, {
      ...sessionResponse,
      identity: { ...sessionResponse.identity, avatarUrl },
    });
    await page.route(avatarUrl, (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );

    await page.goto("/admin");

    await expect(page.getByTestId("nav-avatar-initials")).toHaveText("AA");
    await expect(page.getByTestId("nav-avatar-image")).toHaveCount(0);
  });

  test("filters and paginates the user directory in the admin-v2.7 layout", async ({
    page,
  }) => {
    const manyMembers = Array.from({ length: 12 }, (_, index) => ({
      membershipId: `membership-${index + 1}`,
      userId: `user-${index + 1}`,
      email: `user${index + 1}@acme.test`,
      displayName: `Acme User ${index + 1}`,
      status: index >= 10 ? "SUSPENDED" : "ACTIVE",
      roles: [index % 2 === 0 ? "R-customer" : "R-agent"],
    }));

    await seedSession(page);
    await routeSession(page);
    await page.route("**/tenants/*/users*", (route) =>
      route.fulfill(json(manyMembers)),
    );

    await openUserDirectory(page);

    await expect(page.getByTestId("tenant-invite-card")).toBeVisible();
    await expect(page.getByTestId("tenant-users-directory-card")).toBeVisible();
    await expect(page.getByTestId("tenant-user-row")).toHaveCount(10);
    await expect(page.getByTestId("tenant-users-pagination")).toContainText(
      "Showing 1 to 10 of 12 entries",
    );

    await page.getByTestId("tenant-users-rows").selectOption("5");
    await expect(page.getByTestId("tenant-user-row")).toHaveCount(5);
    await expect(page.getByTestId("tenant-users-pagination")).toContainText(
      "Showing 1 to 5 of 12 entries",
    );

    await page.getByTestId("tenant-users-next").click();
    await expect(page.getByTestId("tenant-users-pagination")).toContainText(
      "Showing 6 to 10 of 12 entries",
    );

    await page
      .getByTestId("tenant-users-status-filter")
      .selectOption("SUSPENDED");
    await expect(page.getByTestId("tenant-user-row")).toHaveCount(2);
    await expect(page.getByTestId("tenant-users-pagination")).toContainText(
      "Showing 1 to 2 of 2 entries",
    );

    await page.getByTestId("tenant-users-search").fill("user12");
    await expect(page.getByTestId("tenant-user-row")).toHaveCount(1);
    await expect(page.getByTestId("tenant-user-row")).toContainText(
      "user12@acme.test",
    );
  });

  test("fits the identity and Sign out in the mobile header at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await routeSession(page);

    await page.goto("/admin");

    await expect(page.getByTestId("nav-identity-mobile")).toBeVisible();
    await expect(page.getByTestId("nav-identity-mobile")).toContainText(
      "Acme Admin",
    );
    await expect(page.getByTestId("nav-identity-mobile")).toContainText(
      "Tenant Admin",
    );
    await expect(page.getByTestId("nav-sign-out-mobile")).toBeVisible();
    await expect(page.getByTestId("nav-avatar-mobile")).toBeVisible();
    await expect(page.getByTestId("nav-sign-out-mobile")).toContainText(
      "Sign out",
    );
    await expect(page.getByTestId("nav-identity")).toBeHidden();
    await expect(page.getByTestId("nav-sign-out")).toBeHidden();
    await expect(page.getByTestId("admin-sign-out")).toHaveCount(0);

    const layout = await mobileHeaderLayout(page);

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.identityLeft).toBeGreaterThanOrEqual(layout.logoRight);
    expect(layout.identityRight).toBeLessThanOrEqual(layout.signOutLeft);
    expect(layout.signOutRight).toBeLessThanOrEqual(layout.menuLeft);
    expect(layout.menuRight).toBeLessThanOrEqual(layout.viewportWidth);
  });

  test("keeps the mobile header inside 320px with a long display name", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await seedSession(page);
    await routeSession(page, {
      ...sessionResponse,
      tenantContext: {
        ...sessionResponse.tenantContext,
        displayName: "Live Governance Administrator",
      },
    });

    await page.goto("/admin");

    await expect(page.getByTestId("nav-identity-mobile")).toContainText(
      "Live Governance Administrator",
    );
    await expect(page.getByTestId("nav-avatar-mobile")).toBeHidden();
    await expect(page.getByTestId("nav-identity-mobile-name")).toHaveAttribute(
      "title",
      "admin@acme.test",
    );
    await expect(page.getByTestId("nav-sign-out-mobile")).toContainText(
      "Sign out",
    );

    const layout = await mobileHeaderLayout(page);

    expect(layout.identityLeft).toBeGreaterThanOrEqual(layout.logoRight);
    expect(layout.identityRight).toBeLessThanOrEqual(layout.signOutLeft);
    expect(layout.signOutRight).toBeLessThanOrEqual(layout.menuLeft);
    expect(layout.menuRight).toBeLessThanOrEqual(320);
    expect(layout.nameScrollWidth).toBeGreaterThan(layout.nameWidth);
  });

  test("keeps status and actions visible in the mobile user directory", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await routeSession(page);
    await page.route("**/tenants/*/users*", (route) =>
      route.fulfill(json(members)),
    );

    await openUserDirectory(page);

    const agentRow = page
      .getByTestId("tenant-user-row")
      .filter({ hasText: "agent@acme.test" });
    await expect(agentRow.getByTestId("tenant-user-status-mobile")).toHaveText(
      "Active",
    );
    await expect(
      agentRow.getByRole("button", { name: "Edit role" }),
    ).toBeVisible();
    await expect(page.getByTestId("tenant-users-pagination")).toBeVisible();
  });

  test("redirects a signed-out visitor from every administrator route", async ({
    page,
  }) => {
    for (const path of ["/admin", "/studio", "/analytics", "/audit"]) {
      await page.goto(path);

      await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
      await expect(
        page.getByRole("heading", { name: "Sign In to VELARIS" }),
      ).toBeVisible();
    }
  });

  test("redirects a signed-in customer away from the admin page", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page, { ...sessionResponse, role: "R-customer" });

    await page.goto("/admin");

    await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Sign In to VELARIS" }),
    ).toBeVisible();
    await expect(page.getByTestId("tenant-users-panel")).toHaveCount(0);
  });
});
