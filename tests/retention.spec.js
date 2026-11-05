// @ts-check
import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Retention settings panel (T6.06; F-14; AC-F14-2; J-05).
 *
 * The panel lives in the existing "System Settings" tab of the admin view.
 * Every API call is intercepted with page.route: the CI runner has no
 * database, and the API is the authority for permissions, so a denial is
 * returned as 403 exactly as the real guard chain returns it.
 *
 * The journeys cover the seeded TRACES window, a client-side rejection
 * before any request, a saved window with the audit confirmation, and the
 * denial state for a role without `retention.manage`.
 */

const SESSION_KEY = "velaris.auth.session.v1";

const session = {
  accessToken: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "admin@example.test",
};

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-e2e",
    email: "admin@example.test",
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

const policies = [
  { category: "KNOWLEDGE", retentionDays: null, configured: false },
  { category: "TRACES", retentionDays: 30, configured: true },
  { category: "MEMORY", retentionDays: null, configured: false },
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

async function routeSession(page) {
  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionResponse)),
  );
}

async function openSettings(page) {
  await page.goto("/admin");
  await page.getByRole("button", { name: /System Settings/ }).click();
  await expect(
    page.getByRole("heading", { name: "Data retention" }),
  ).toBeVisible();
}

test.describe("retention settings (T6.06, AC-F14-2)", () => {
  test("shows the three categories with the seeded TRACES window", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) =>
      route.fulfill(json({ tenantId: "tenant-a", policies })),
    );

    await openSettings(page);

    await expect(page.locator("#retention-traces")).toHaveValue("30");
    await expect(page.locator("#retention-knowledge")).toHaveValue("");

    const memory = page
      .getByRole("listitem")
      .filter({ hasText: "Customer memory" });
    await expect(memory).toContainText("Default");
  });

  test("rejects an out-of-range window before any request", async ({
    page,
  }) => {
    let putCalls = 0;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) => {
      if (route.request().method() === "PUT") putCalls += 1;
      return route.fulfill(json({ tenantId: "tenant-a", policies }));
    });

    await openSettings(page);

    const knowledge = page
      .getByRole("listitem")
      .filter({ hasText: "Knowledge sources" });
    await knowledge.locator("#retention-knowledge").fill("0");
    await knowledge.getByRole("button", { name: "Save" }).click();

    await expect(knowledge.getByRole("alert")).toContainText(
      "between 1 and 3650",
    );
    expect(putCalls).toBe(0);
  });

  test("saves a window and confirms the audit record", async ({ page }) => {
    const saved = {
      category: "KNOWLEDGE",
      retentionDays: 400,
      configured: true,
    };
    let payload = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) => {
      if (route.request().method() === "PUT") {
        payload = route.request().postDataJSON();
        return route.fulfill(json(saved));
      }
      return route.fulfill(json({ tenantId: "tenant-a", policies }));
    });

    await openSettings(page);

    const knowledge = page
      .getByRole("listitem")
      .filter({ hasText: "Knowledge sources" });
    await knowledge.locator("#retention-knowledge").fill("400");
    await knowledge.getByRole("button", { name: "Save" }).click();

    await expect(knowledge.getByRole("status")).toContainText(
      "retention.policy_changed",
    );
    expect(payload).toEqual({
      tenantId: "tenant-a",
      category: "KNOWLEDGE",
      retentionDays: 400,
    });
  });

  test("denies a role without retention.manage", async ({ page }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) =>
      route.fulfill(
        json(
          { statusCode: 403, message: "Missing permission: retention.manage" },
          403,
        ),
      ),
    );

    await openSettings(page);

    await expect(page.getByTestId("retention-denied")).toContainText(
      "cannot configure retention windows",
    );
  });

  test("shows the newest retention change and links to the filtered audit trail", async ({
    page,
  }) => {
    let auditQuery = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) =>
      route.fulfill(json({ tenantId: "tenant-a", policies })),
    );
    await page.route("**/audit/events*", (route) => {
      const url = new URL(route.request().url());
      auditQuery = Object.fromEntries(url.searchParams.entries());
      return route.fulfill(
        json({
          items: [
            {
              id: "event-retention",
              actorId: "user-1",
              action: "retention.policy_changed",
              metadata: { category: "MEMORY", retentionDays: 7 },
              createdAt: "2026-11-05T10:00:00.000Z",
            },
          ],
          limit: 1,
          hasMore: false,
        }),
      );
    });

    await openSettings(page);

    const line = page.getByTestId("retention-last-change");
    await expect(line).toContainText("MEMORY · 7 days · actor user-1");
    await expect(line).toContainText("2026-11-05 10:00:00 UTC");
    await expect(
      line.getByRole("link", { name: "View in audit trail" }),
    ).toHaveAttribute("href", "/audit#retention");
    await expect
      .poll(() => auditQuery?.action)
      .toBe("retention.policy_changed");
    expect(auditQuery?.limit).toBe("1");
  });

  test("hides the last change when audit.read is denied", async ({ page }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) =>
      route.fulfill(json({ tenantId: "tenant-a", policies })),
    );
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );

    await openSettings(page);

    await expect(page.getByTestId("retention-last-change")).toHaveCount(0);
    await expect(page.locator("#retention-traces")).toHaveValue("30");
  });

  test("passes the automated WCAG scan", async ({ page }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/settings/retention*", (route) =>
      route.fulfill(json({ tenantId: "tenant-a", policies })),
    );

    await openSettings(page);
    await expectNoSeriousA11yViolations(page, "retention settings");
  });
});
