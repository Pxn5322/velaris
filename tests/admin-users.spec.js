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
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
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
