// @ts-check
import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Journey J-05 / T5.04 verify: analytics, audit trail and AI traces.
 *
 * Maps to F-11 and F-12: AC-F12-1 (documented KPI formulas, tenant scope),
 * AC-F11-3 (restricted audit/trace reads are denied) and the explicit
 * loading / empty / stale / failure / denial states of both views.
 *
 * Every API call is intercepted with page.route: the CI runner has no
 * database. The API is the authority for permissions, so the denial case
 * returns 403 exactly as the real guard chain does for R-agent.
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
};

function metric(code, label, unit, value, sample, formula) {
  return {
    code,
    label,
    unit,
    definitionVersion: "1.0.0",
    formula,
    value,
    sample,
  };
}

const emptySummary = {
  tenantId: "tenant-a",
  range: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-03T00:00:00.000Z" },
  generatedAt: "2026-11-03T09:00:00.000Z",
  state: "EMPTY",
  staleAfterMinutes: 60,
  lastEventAt: null,
  metrics: [
    metric(
      "ai_resolution_rate",
      "AI resolution rate",
      "ratio",
      null,
      0,
      "Resolved by AI divided by AI conversations.",
    ),
    metric(
      "escalation_rate",
      "Escalation rate",
      "ratio",
      null,
      0,
      "Conversations with a ticket divided by AI conversations.",
    ),
    metric(
      "ticket_resolution_hours",
      "Ticket resolution time (median)",
      "hours",
      null,
      0,
      "Median of resolved_at minus created_at.",
    ),
    metric(
      "open_ticket_backlog",
      "Open ticket backlog",
      "count",
      null,
      0,
      "Unresolved tickets at the range end.",
    ),
    metric(
      "ai_latency_p95_ms",
      "AI latency p95",
      "milliseconds",
      null,
      0,
      "Nearest-rank 95th percentile of latency_ms.",
    ),
    metric(
      "audit_event_count",
      "Audited actions",
      "count",
      null,
      0,
      "Audit events created in the range.",
    ),
  ],
};

const readySummary = {
  ...emptySummary,
  state: "OK",
  lastEventAt: "2026-11-03T08:59:00.000Z",
  metrics: [
    metric(
      "ai_resolution_rate",
      "AI resolution rate",
      "ratio",
      0.75,
      40,
      "Resolved by AI divided by AI conversations.",
    ),
    metric(
      "escalation_rate",
      "Escalation rate",
      "ratio",
      0.125,
      40,
      "Conversations with a ticket divided by AI conversations.",
    ),
    metric(
      "ticket_resolution_hours",
      "Ticket resolution time (median)",
      "hours",
      2.5,
      12,
      "Median of resolved_at minus created_at.",
    ),
    metric(
      "open_ticket_backlog",
      "Open ticket backlog",
      "count",
      7,
      7,
      "Unresolved tickets at the range end.",
    ),
    metric(
      "ai_latency_p95_ms",
      "AI latency p95",
      "milliseconds",
      910.4,
      120,
      "Nearest-rank 95th percentile of latency_ms.",
    ),
    metric(
      "audit_event_count",
      "Audited actions",
      "count",
      31,
      31,
      "Audit events created in the range.",
    ),
  ],
};

const staleSummary = {
  ...readySummary,
  state: "STALE",
  lastEventAt: "2026-11-01T00:00:00.000Z",
};

const auditEvent = {
  id: "event-1",
  tenantId: "tenant-a",
  actorId: "user-1",
  action: "ticket.updated",
  resourceType: "ticket",
  resourceId: "ticket-1",
  requestId: "req-abc",
  metadata: {},
  createdAt: "2026-11-03T08:00:00.000Z",
};

const retentionEvent = {
  ...auditEvent,
  id: "event-retention",
  action: "retention.policy_changed",
  resourceType: "retention_policy",
  resourceId: "MEMORY",
  metadata: { category: "MEMORY", retentionDays: 7 },
};

const aiTrace = {
  id: "trace-1",
  tenantId: "tenant-a",
  correlationId: "req-abc",
  provider: "openai",
  model: "gpt-4.1-mini",
  outcome: "SUCCESS",
  latencyMs: 820,
  createdAt: "2026-11-03T08:00:01.000Z",
  expiresAt: "2026-12-03T08:00:01.000Z",
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
    [SESSION_KEY, JSON.stringify(session)],
  );
}

/** Signed-in request routing shared by both views. */
async function routeSession(page) {
  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionResponse)),
  );
}

test.describe("analytics and governance views (T5.04, AC-F12 / AC-F11-3)", () => {
  test("signed out, analytics offers a sign-in path", async ({ page }) => {
    await page.goto("/analytics");

    await expect(page.getByTestId("analytics-denied")).toBeVisible();
    await expect(page.getByTestId("analytics-denied")).toContainText("Sign in");
  });

  test("shows the loading state before the summary arrives", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/analytics/summary*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill(json(readySummary));
    });

    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-loading")).toBeVisible();
    await expect(page.getByTestId("analytics-summary")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("reports EMPTY with null values and the documented definitions (AC-F12-1, AC-F12-2)", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/analytics/summary*", (route) =>
      route.fulfill(json(emptySummary)),
    );

    await page.goto("/analytics");

    await expect(page.getByTestId("analytics-empty")).toBeVisible();
    await expect(page.getByTestId("analytics-summary")).toHaveAttribute(
      "data-state",
      "EMPTY",
    );
    await expect(
      page.getByTestId("analytics-value-ai_resolution_rate"),
    ).toHaveText("—");
    await expect(page.getByTestId("analytics-definitions")).toContainText(
      "ai_resolution_rate · v1.0.0",
    );
    await expect(page.getByTestId("analytics-definitions")).toContainText(
      "Nearest-rank 95th percentile of latency_ms.",
    );
  });

  test("renders the KPI values in their units", async ({ page }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/analytics/summary*", (route) =>
      route.fulfill(json(readySummary)),
    );

    await page.goto("/analytics");

    await expect(
      page.getByTestId("analytics-value-ai_resolution_rate"),
    ).toHaveText("75.0%");
    await expect(
      page.getByTestId("analytics-value-ticket_resolution_hours"),
    ).toHaveText("2.50 h");
    await expect(
      page.getByTestId("analytics-value-ai_latency_p95_ms"),
    ).toHaveText("910 ms");
    await expect(
      page.getByTestId("analytics-value-open_ticket_backlog"),
    ).toHaveText("7");

    // NFR-08: the analytics view with KPI values rendered.
    await expectNoSeriousA11yViolations(page, "analytics KPI view");
  });

  test("marks a stale summary instead of implying live data", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/analytics/summary*", (route) =>
      route.fulfill(json(staleSummary)),
    );

    await page.goto("/analytics");

    await expect(page.getByTestId("analytics-stale")).toContainText(
      "2026-11-01 00:00 UTC",
    );
    await expect(page.getByTestId("analytics-summary")).toHaveAttribute(
      "data-state",
      "STALE",
    );
  });

  test("shows a retry after a failure and recovers", async ({ page }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/analytics/summary*", (route) =>
      route.fulfill(json({ message: "Internal error" }, 500)),
    );

    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-error")).toBeVisible();

    await page.route("**/analytics/summary*", (route) =>
      route.fulfill(json(readySummary)),
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("analytics-summary")).toBeVisible();
  });

  test("denies a viewer without analytics.read (AC-F12-3)", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/analytics/summary*", (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );

    await page.goto("/analytics");

    await expect(page.getByTestId("analytics-denied")).toContainText(
      "cannot read analytics",
    );
    await expect(page.getByTestId("analytics-summary")).toHaveCount(0);
  });

  test("denies audit records without audit.read (AC-F11-3)", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );
    await page.route("**/audit/traces*", (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );

    await page.goto("/audit");

    await expect(page.getByTestId("audit-denied")).toContainText(
      "cannot read audit records",
    );
    await expect(page.getByTestId("audit-events-list")).toHaveCount(0);
  });

  test("lists audit events with their request id and AI traces", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ items: [auditEvent], limit: 25, hasMore: false })),
    );
    await page.route("**/audit/traces*", (route) =>
      route.fulfill(json({ items: [aiTrace], limit: 25, hasMore: false })),
    );

    await page.goto("/audit");

    await expect(page.getByTestId("audit-event")).toHaveCount(1);
    await expect(page.getByTestId("audit-events-list")).toContainText(
      "ticket.updated",
    );
    await expect(page.getByTestId("audit-event-request")).toContainText(
      "req-abc",
    );

    await page.getByTestId("audit-tab-traces").click();
    await expect(page.getByTestId("audit-trace")).toHaveCount(1);
    await expect(page.getByTestId("audit-traces-list")).toContainText(
      "gpt-4.1-mini",
    );
    await expect(page.getByTestId("audit-traces-list")).toContainText("820 ms");
  });

  test("shows a retention change with its actor, category and window", async ({
    page,
  }) => {
    let requestedAction = null;
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) => {
      const url = new URL(route.request().url());
      requestedAction = url.searchParams.get("action");
      return route.fulfill(
        json({
          items: [retentionEvent],
          limit: 25,
          hasMore: false,
        }),
      );
    });
    await page.route("**/audit/traces*", (route) =>
      route.fulfill(json({ items: [], limit: 25, hasMore: false })),
    );

    await page.goto("/audit");

    await expect(page.getByTestId("audit-event-retention")).toContainText(
      "MEMORY · 7 days · actor user-1",
    );

    await page.getByTestId("audit-retention-filter").click();
    await expect(page.getByTestId("audit-retention-filter")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => requestedAction).toBe("retention.policy_changed");
    await expect(page.getByTestId("audit-event-retention")).toContainText(
      "MEMORY",
    );
  });

  test("shows empty states when the tenant has no records", async ({
    page,
  }) => {
    await seedSession(page);
    await routeSession(page);
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ items: [], limit: 25, hasMore: false })),
    );
    await page.route("**/audit/traces*", (route) =>
      route.fulfill(json({ items: [], limit: 25, hasMore: false })),
    );

    await page.goto("/audit");
    await expect(page.getByTestId("audit-empty-events")).toBeVisible();

    await page.getByTestId("audit-tab-traces").click();
    await expect(page.getByTestId("audit-empty-traces")).toBeVisible();
  });
});
