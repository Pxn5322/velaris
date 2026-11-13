// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Administrator analytics audit stream (F-11, F-12, J-05).
 *
 * The analytics tab keeps its KPI cards and adds the prototype's lower
 * audit-stream panel. The panel must render real GET /audit/events rows for
 * the tenant resolved by GET /auth/session, not sample rows from the
 * prototype. It also keeps the governance states explicit: loading, empty,
 * failure with retry and denial.
 *
 * The API calls are intercepted because the CI runner has no database.
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
  role: "R-enterprise-admin",
};

const events = [
  {
    id: "event-1",
    actorId: "user-1",
    action: "ticket.updated",
    resourceType: "ticket",
    resourceId: "ticket-1",
    requestId: "req-abc",
    createdAt: "2026-11-13T09:42:00.000Z",
  },
  {
    id: "event-2",
    actorId: null,
    action: "retention.policy_changed",
    resourceType: "retention_policy",
    resourceId: "TRANSCRIPTS",
    requestId: null,
    createdAt: "2026-11-13T08:15:00.000Z",
  },
  {
    id: "event-3",
    actorId: "user-2",
    action: "membership.role_changed",
    resourceType: "membership",
    resourceId: "membership-4",
    requestId: "req-def",
    createdAt: "2026-11-12T16:20:00.000Z",
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

async function routeSession(page) {
  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionResponse)),
  );
}

test.describe("administrator analytics audit stream", () => {
  test("renders real audit events for the signed-in tenant", async ({
    page,
  }) => {
    let requestedUrl = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) => {
      requestedUrl = new URL(route.request().url());
      return route.fulfill(json({ items: events, limit: 8, hasMore: false }));
    });

    await page.goto("/admin");

    await expect(
      page.getByRole("heading", {
        name: "Real-Time Audit & Security Event Stream",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-audit-stream-tenant")).toContainText(
      "Acme",
    );
    await expect(page.getByTestId("admin-audit-event")).toHaveCount(3);

    const rows = page.getByTestId("admin-audit-event");
    await expect(rows.first()).toContainText("ticket.updated");
    await expect(rows.first()).toContainText("ticket-1");
    await expect(rows.first()).toContainText("request req-abc");
    await expect(rows.nth(1)).toContainText("retention.policy_changed");
    await expect(rows.nth(1)).toContainText("request none recorded");
    await expect(rows.nth(1)).toContainText("actor none recorded");

    expect(requestedUrl?.pathname).toBe("/audit/events");
    expect(requestedUrl?.searchParams.get("tenantId")).toBe("tenant-a");
    expect(requestedUrl?.searchParams.get("limit")).toBe("8");
  });

  test("shows loading before the first audit page arrives", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill(json({ items: events, limit: 8, hasMore: false }));
    });

    await page.goto("/admin");

    await expect(page.getByTestId("admin-audit-stream-loading")).toBeVisible();
    await expect(page.getByTestId("admin-audit-event")).toHaveCount(3, {
      timeout: 10_000,
    });
  });

  test("shows an empty state when the tenant has no audit events", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ items: [], limit: 8, hasMore: false })),
    );

    await page.goto("/admin");

    await expect(page.getByTestId("admin-audit-stream-empty")).toContainText(
      "No audit events",
    );
  });

  test("shows an error and recovers on retry", async ({ page }) => {
    let calls = 0;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) => {
      calls += 1;
      return calls === 1
        ? route.fulfill(json({ message: "Audit store unavailable" }, 500))
        : route.fulfill(json({ items: events, limit: 8, hasMore: false }));
    });

    await page.goto("/admin");

    await expect(page.getByTestId("admin-audit-stream-error")).toContainText(
      "Audit store unavailable",
    );
    await page.getByTestId("admin-audit-stream-retry").click();

    await expect(page.getByTestId("admin-audit-event")).toHaveCount(3);
  });

  test("denies the feed when the API refuses audit.read", async ({ page }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );

    await page.goto("/admin");

    await expect(page.getByTestId("admin-audit-stream-denied")).toContainText(
      "cannot read audit events",
    );
    await expect(page.getByTestId("admin-audit-event")).toHaveCount(0);
  });
});
