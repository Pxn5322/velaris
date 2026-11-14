// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Roles & RBAC CRUD.
 *
 * The API is intercepted. The journey proves the admin-v2.7 role matrix is
 * backed by the tenant role routes: create a custom role with a canonical
 * permission profile, rename it, and delete it. System roles stay read-only.
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

const roles = [
  {
    id: "11111111-1111-4111-8111-111111111102",
    code: "R-tenant-admin",
    name: "Tenant administrator",
    systemManaged: true,
    baseRoleCode: "R-tenant-admin",
    membershipCount: 1,
    permissionCount: 15,
  },
  {
    id: "11111111-1111-4111-8111-111111111103",
    code: "R-agent",
    name: "Support agent",
    systemManaged: true,
    baseRoleCode: "R-agent",
    membershipCount: 2,
    permissionCount: 5,
  },
];

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test.describe("Roles & RBAC", () => {
  test("creates, edits and deletes a custom role", async ({ page }) => {
    const calls = [];
    let current = [...roles];

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(session)],
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tenants\/tenant-a\/roles(?:\/.*)?$/, (route) => {
      const request = route.request();
      const method = request.method();
      const body =
        method === "GET" || method === "DELETE"
          ? null
          : request.postDataJSON();
      calls.push({ method, body });

      if (method === "GET") return route.fulfill(json(current));
      if (method === "POST") {
        const created = {
          id: "22222222-2222-4222-8222-222222222222",
          code: body.code,
          name: body.name,
          systemManaged: false,
          baseRoleCode: body.baseRoleCode,
          membershipCount: 0,
          permissionCount: 5,
        };
        current = [...current, created];
        return route.fulfill(json(created, 201));
      }
      if (method === "PATCH") {
        const id = request.url().split("/").pop();
        const updated = {
          ...current.find((role) => role.id === id),
          name: body.name,
          baseRoleCode: body.baseRoleCode,
          permissionCount: body.baseRoleCode === "R-tenant-admin" ? 15 : 5,
        };
        current = current.map((role) => (role.id === id ? updated : role));
        return route.fulfill(json(updated));
      }
      const id = request.url().split("/").pop();
      current = current.filter((role) => role.id !== id);
      return route.fulfill(json({ id, deleted: true }));
    });

    await page.goto("/admin");
    await page.getByRole("button", { name: "Roles & RBAC" }).click();
    await expect(page.getByTestId("roles-panel")).toBeVisible();
    await expect(page.getByTestId("role-card")).toHaveCount(2);
    await expect(
      page.getByTestId("role-card").filter({ hasText: "Support agent" }),
    ).not.toContainText("Edit");

    await page.getByTestId("role-create-open").click();
    await page.getByTestId("role-code").fill("R-support-lead");
    await page.getByTestId("role-name").fill("Support lead");
    await page.getByTestId("role-base").selectOption("R-agent");
    await page.getByTestId("role-create-submit").click();

    await expect(page.getByTestId("roles-notice")).toContainText(
      "Support lead was created",
    );
    const createdCard = page.locator(
      '[data-testid="role-card"][data-role-code="R-support-lead"]',
    );
    await expect(createdCard).toContainText("CUSTOM");
    await expect(createdCard).toContainText("5 permissions");
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      code: "R-support-lead",
      name: "Support lead",
      baseRoleCode: "R-agent",
    });

    await createdCard.getByTestId("role-edit").click();
    await createdCard.getByTestId("role-edit-name").fill("Escalation lead");
    await createdCard.getByTestId("role-edit-base").selectOption(
      "R-tenant-admin",
    );
    await createdCard.getByTestId("role-save").click();

    await expect(createdCard).toContainText("Escalation lead");
    await expect(createdCard).toContainText("15 permissions");

    page.once("dialog", (dialog) => dialog.accept());
    await createdCard.getByTestId("role-delete").click();

    await expect(createdCard).toHaveCount(0);
    await expect(page.getByTestId("roles-notice")).toContainText(
      "Escalation lead was deleted",
    );
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });
});
