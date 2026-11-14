// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Session and role route gates.
 *
 * A typed URL without a session must not render a protected work area. A
 * signed-in role sees only the navigation entries that belong to it, and the
 * route-level guard refuses a work area outside that role.
 */

const SESSION_KEY = "velaris.auth.session.v1";
const SESSION = {
  accessToken: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "user@acme.test",
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function sessionFor(role, email) {
  return {
    identity: {
      provider: "supabase",
      subject: "sub-e2e",
      email,
      displayName: role === "AGENT" ? "Acme Agent" : "Acme Customer",
    },
    tenantContext: {
      userId: "user-1",
      displayName: "Acme",
      tenants: [
        {
          tenantId: "tenant-a",
          slug: "acme",
          name: "Acme",
          membershipId: "membership-1",
        },
      ],
    },
    role,
  };
}

async function seed(page, role, email) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify({ ...SESSION, email })],
  );
  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionFor(role, email))),
  );
}

test.describe("session and role route gates", () => {
  test("redirects signed-out typed URLs to sign-in", async ({ page }) => {
    for (const path of [
      "/inbox",
      "/workspace",
      "/portal",
      "/portal/conversations",
      "/not-a-real-workspace",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
      await expect(
        page.getByRole("heading", { name: "Sign In to VELARIS" }),
      ).toBeVisible();
    }
  });

  test("an agent sees only agent navigation and cannot open admin", async ({
    page,
  }) => {
    await seed(page, "R-agent", "agent@acme.test");
    await page.route("**/tickets*", (route) => route.fulfill(json([])));
    await page.route("**/conversations*", (route) => route.fulfill(json([])));

    await page.goto("/inbox");
    await expect(page.getByRole("link", { name: "Agent Workspace" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Support Inbox" })).toBeVisible();
    await expect(page.getByRole("link", { name: "AI Studio" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Audit" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Customer Portal" })).toHaveCount(
      0,
    );

    await page.goto("/admin");
    await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
  });

  test("a customer sees only the portal and cannot open the inbox", async ({
    page,
  }) => {
    await seed(page, "R-customer", "customer@acme.test");
    await page.route("**/conversations*", (route) => route.fulfill(json([])));

    await page.goto("/portal");
    await expect(
      page.getByRole("link", { name: "Customer Portal" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Support Inbox" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Agent Workspace" })).toHaveCount(
      0,
    );

    await page.goto("/inbox");
    await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
  });
});
