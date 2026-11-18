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
  test("keeps role creation disabled until the tenant loads", async ({
    page,
  }) => {
    let sessionCalls = 0;

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(session)],
    );
    await page.route("**/auth/session*", async (route) => {
      sessionCalls += 1;
      if (sessionCalls > 1) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      await route.fulfill(json(sessionResponse));
    });
    await page.route(/\/tenants\/tenant-a\/roles(?:\/.*)?$/, (route) =>
      route.fulfill(json(roles)),
    );

    await page.goto("/admin");
    await page.getByRole("button", { name: "Roles & RBAC" }).click();

    const createButton = page.getByTestId("role-create-open");
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeDisabled();
    await expect(page.getByTestId("role-create-form")).toHaveCount(0);

    await expect(createButton).toBeEnabled({ timeout: 8_000 });
    await createButton.click();
    await expect(page.getByTestId("role-create-form")).toBeVisible();
  });

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
        method === "GET" || method === "DELETE" ? null : request.postDataJSON();
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
    await expect(page.getByTestId("roles-refresh")).toBeVisible();
    await expect(page.getByTestId("role-create-open")).toBeVisible();
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
    await createdCard
      .getByTestId("role-edit-base")
      .selectOption("R-tenant-admin");
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

  test("re-authenticates and enrolls TOTP before a sensitive role change", async ({
    page,
  }) => {
    let submitted = null;

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(session)],
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tenants\/tenant-a\/roles(?:\/.*)?$/, (route) => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill(json(roles));
      const grant = request.headers()["x-step-up-token"];
      if (!grant) {
        return route.fulfill(
          json(
            {
              code: "STEP_UP_REQUIRED",
              message: "A recent step-up is required for this action",
            },
            403,
          ),
        );
      }
      submitted = { body: request.postDataJSON(), grant };
      return route.fulfill(
        json(
          {
            id: "22222222-2222-4222-8222-222222222222",
            code: "R-support-lead",
            name: "Support lead",
            systemManaged: false,
            baseRoleCode: "R-agent",
            membershipCount: 0,
            permissionCount: 5,
          },
          201,
        ),
      );
    });

    // The API still sees an aal1 token, so it asks for the second factor.
    await page.route("**/auth/step-up", (route) => {
      if (
        route.request().headers()["authorization"] !==
        "Bearer e2e-mfa-access-token"
      ) {
        return route.fulfill(
          json(
            {
              code: "MFA_REQUIRED",
              message: "Multi-factor authentication is required",
            },
            403,
          ),
        );
      }
      return route.fulfill(json({ token: "grant-1" }));
    });

    await page.route("**/auth/v1/user", (route) =>
      route.fulfill(json({ factors: [] })),
    );
    await page.route("**/auth/v1/factors", (route) =>
      route.fulfill(
        json({
          id: "factor-1",
          totp: {
            qr_code: "data:image/svg+xml;base64,PHN2Zy8+",
            secret: "JBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/VELARIS",
          },
        }),
      ),
    );
    await page.route("**/auth/v1/factors/factor-1/challenge", (route) =>
      route.fulfill(json({ id: "challenge-1" })),
    );
    await page.route("**/auth/v1/factors/factor-1/verify", (route) =>
      route.fulfill(
        json({
          access_token: "e2e-mfa-access-token",
          refresh_token: "e2e-mfa-refresh-token",
          expires_in: 3600,
          user: { email: "admin@acme.test" },
        }),
      ),
    );

    await page.goto("/admin");
    await page.getByRole("button", { name: "Roles & RBAC" }).click();
    await page.getByTestId("role-create-open").click();
    await page.getByTestId("role-code").fill("R-support-lead");
    await page.getByTestId("role-name").fill("Support lead");
    await page.getByTestId("role-create-submit").click();

    await expect(page.getByTestId("step-up-dialog")).toBeVisible();
    await page.getByTestId("step-up-password").fill("correct horse battery");
    await page.getByTestId("step-up-password-submit").click();

    await expect(page.getByTestId("step-up-mfa-form")).toBeVisible();
    await expect(page.getByTestId("step-up-mfa-form")).toContainText(
      "JBSWY3DPEHPK3PXP",
    );
    await page.getByTestId("step-up-code").fill("123456");
    await page.getByTestId("step-up-code-submit").click();

    await expect(page.getByTestId("roles-notice")).toContainText(
      "Support lead was created",
    );
    expect(submitted).toEqual({
      body: {
        code: "R-support-lead",
        name: "Support lead",
        baseRoleCode: "R-agent",
      },
      grant: "grant-1",
    });
    const stored = await page.evaluate((key) => {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, SESSION_KEY);
    expect(stored.accessToken).toBe("e2e-mfa-access-token");
  });

  test("selects the backup authenticator during step-up", async ({ page }) => {
    const challenges = [];
    let submitted = null;

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(session)],
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tenants\/tenant-a\/roles(?:\/.*)?$/, (route) => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill(json(roles));
      const grant = request.headers()["x-step-up-token"];
      if (!grant) {
        return route.fulfill(
          json(
            {
              code: "STEP_UP_REQUIRED",
              message: "A recent step-up is required for this action",
            },
            403,
          ),
        );
      }
      submitted = { body: request.postDataJSON(), grant };
      return route.fulfill(
        json(
          {
            id: "22222222-2222-4222-8222-222222222222",
            code: "R-support-lead",
            name: "Support lead",
            systemManaged: false,
            baseRoleCode: "R-agent",
            membershipCount: 0,
            permissionCount: 5,
          },
          201,
        ),
      );
    });
    await page.route("**/auth/step-up", (route) => {
      if (
        route.request().headers()["authorization"] !==
        "Bearer e2e-mfa-access-token"
      ) {
        return route.fulfill(
          json(
            {
              code: "MFA_REQUIRED",
              message: "Multi-factor authentication is required",
            },
            403,
          ),
        );
      }
      return route.fulfill(json({ token: "grant-1" }));
    });
    await page.route("**/auth/v1/user", (route) =>
      route.fulfill(
        json({
          factors: [
            {
              id: "factor-1",
              friendly_name: "VELARIS",
              factor_type: "totp",
              status: "verified",
            },
            {
              id: "factor-2",
              friendly_name: "VELARIS backup",
              factor_type: "totp",
              status: "verified",
            },
          ],
        }),
      ),
    );
    await page.route("**/auth/v1/factors/factor-1/challenge", (route) => {
      challenges.push("factor-1");
      return route.fulfill(json({ id: "challenge-1" }));
    });
    await page.route("**/auth/v1/factors/factor-1/verify", (route) =>
      route.fulfill(
        json({
          access_token: "unexpected-factor-1",
          refresh_token: "unexpected-factor-1-refresh",
          expires_in: 3600,
        }),
      ),
    );
    await page.route("**/auth/v1/factors/factor-2/challenge", (route) => {
      challenges.push("factor-2");
      return route.fulfill(json({ id: "challenge-2" }));
    });
    await page.route("**/auth/v1/factors/factor-2/verify", (route) =>
      route.fulfill(
        json({
          access_token: "e2e-mfa-access-token",
          refresh_token: "e2e-mfa-refresh-token",
          expires_in: 3600,
          user: { email: "admin@acme.test" },
        }),
      ),
    );

    await page.goto("/admin");
    await page.getByRole("button", { name: "Roles & RBAC" }).click();
    await page.getByTestId("role-create-open").click();
    await page.getByTestId("role-code").fill("R-support-lead");
    await page.getByTestId("role-name").fill("Support lead");
    await page.getByTestId("role-create-submit").click();

    await expect(page.getByTestId("step-up-dialog")).toBeVisible();
    await page.getByTestId("step-up-password").fill("correct horse battery");
    await page.getByTestId("step-up-password-submit").click();
    await page.getByTestId("step-up-factor").selectOption("factor-2");
    await page.getByTestId("step-up-code").fill("654321");
    await page.getByTestId("step-up-code-submit").click();

    await expect(page.getByTestId("roles-notice")).toContainText(
      "Support lead was created",
    );
    expect(challenges).toEqual(["factor-2"]);
    expect(submitted).toEqual({
      body: {
        code: "R-support-lead",
        name: "Support lead",
        baseRoleCode: "R-agent",
      },
      grant: "grant-1",
    });
  });
});
