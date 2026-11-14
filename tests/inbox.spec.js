// @ts-check
import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Journey J-04 / T2.04 verify: the role-aware agent inbox.
 *
 * Maps to AC-F06-1 (inbox loads with loading/empty states), AC-F06-2
 * (assigned-to-me view) and AC-F06-3 (denial states), plus the AC-F05-2
 * conflict surface: a stale status update must surface as a visible
 * conflict, never a silent overwrite.
 *
 * Every API call is intercepted with page.route: the CI runner has no
 * database, and the journeys must prove UI states deterministically.
 * The signed-in state is injected as the session the auth library
 * stores, so the guard chain itself is exercised in the API integration
 * specs, not here.
 */

const SESSION_KEY = "velaris.auth.session.v1";

const session = {
  accessToken: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "agent@example.test",
};

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-e2e",
    email: "agent@example.test",
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
  role: "R-agent",
};

const tickets = [
  {
    id: "ticket-1",
    customerId: "customer-1",
    title: "Refund not received",
    status: "OPEN",
    priority: "HIGH",
    version: 0,
    assigneeMembershipId: "membership-1",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ticket-2",
    customerId: "customer-2",
    title: "Other customer ticket",
    status: "OPEN",
    priority: "LOW",
    version: 3,
    assigneeMembershipId: "membership-other",
    updatedAt: new Date().toISOString(),
  },
];

const conversations = [
  {
    id: "conv-1",
    customerId: "customer-1",
    channel: "email",
    status: "OPEN",
    version: 0,
    createdAt: "2026-10-20T10:00:00Z",
  },
];

const timeline = {
  ...conversations[0],
  messages: [
    {
      id: "msg-1",
      body: "My refund has not arrived.",
      authorType: "CUSTOMER",
      visibility: "CUSTOMER_VISIBLE",
      createdAt: "2026-10-20T10:00:00Z",
    },
    {
      id: "msg-2",
      body: "Churn risk, prioritize.",
      authorType: "AGENT",
      visibility: "INTERNAL",
      createdAt: "2026-10-20T10:05:00Z",
    },
    {
      id: "msg-3",
      body: "We are processing it now.",
      authorType: "AGENT",
      visibility: "CUSTOMER_VISIBLE",
      createdAt: "2026-10-20T10:06:00Z",
    },
  ],
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

test.describe("agent inbox (AC-F06, J-04)", () => {
  test("redirects a signed-out visitor from the inbox (AC-F06-3)", async ({
    page,
  }) => {
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Sign In to VELARIS" }),
    ).toBeVisible();
    await expect(page.getByTestId("inbox-denied")).toHaveCount(0);
  });

  test("shows the loading state before tickets arrive", async ({ page }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill(json(tickets));
    });

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-loading")).toBeVisible();
    await expect(page.getByTestId("inbox-ticket").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows the empty state when the tenant has no tickets (AC-F06-1)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json([])));

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-empty")).toBeVisible();
  });

  test("shows the error state with retry when the API fails (AC-F06-1)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) =>
      route.fulfill(json({ message: "Internal error" }, 500)),
    );

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-error")).toBeVisible();

    // Retry after the API recovers.
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("inbox-ticket")).toHaveCount(2);
  });

  test("redirects when the session is rejected (401)", async ({ page }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json({ message: "Unauthorized" }, 401)),
    );

    await page.goto("/inbox");
    await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
    await expect(page.getByTestId("inbox-denied")).toHaveCount(0);
  });

  test("assigned-to-me filters the list by the caller membership (AC-F06-2)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-ticket")).toHaveCount(2);

    await page.getByTestId("inbox-tab-mine").click();
    await expect(page.getByTestId("inbox-ticket")).toHaveCount(1);
    await expect(page.getByTestId("inbox-ticket")).toContainText(
      "Refund not received",
    );

    await page.getByTestId("inbox-tab-all").click();
    await expect(page.getByTestId("inbox-ticket")).toHaveCount(2);
  });

  test("renders the admin-v2.7 workspace and paginates the queue", async ({
    page,
  }) => {
    const manyTickets = Array.from({ length: 5 }, (_, index) => ({
      id: `ticket-${index + 1}`,
      customerId: `customer-${index + 1}`,
      title: `Ticket ${index + 1}`,
      status: "OPEN",
      priority: index === 0 ? "HIGH" : "LOW",
      version: 0,
      assigneeMembershipId: "membership-1",
      updatedAt: new Date().toISOString(),
    }));

    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) =>
      route.fulfill(json(manyTickets)),
    );

    await page.goto("/inbox");

    await expect(
      page.getByRole("heading", { name: "Unified Agent Inbox & Copilot" }),
    ).toBeVisible();
    await expect(page.getByTestId("inbox-layout")).toBeVisible();
    await expect(page.getByTestId("inbox-queue")).toBeVisible();
    await expect(page.getByTestId("inbox-copilot")).toBeVisible();
    await expect(page.getByTestId("inbox-ticket")).toHaveCount(3);

    await page.getByTestId("inbox-rows").selectOption("5");
    await expect(page.getByTestId("inbox-ticket")).toHaveCount(5);

    await page.getByTestId("inbox-toggle-copilot").click();
    await expect(page.getByTestId("inbox-copilot")).toHaveCount(0);
    await page.getByTestId("inbox-toggle-copilot").click();
    await expect(page.getByTestId("inbox-copilot")).toBeVisible();

    await expectNoSeriousA11yViolations(page, "agent inbox workspace");
  });

  test("sends a customer-visible reply from the composer", async ({ page }) => {
    let posted = null;
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1**", (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON();
        return route.fulfill(
          json({
            id: "msg-4",
            body: posted.body,
            authorType: "AGENT",
            visibility: posted.visibility,
            createdAt: "2026-10-20T10:07:00Z",
          }),
        );
      }
      return route.fulfill(json(timeline));
    });

    await page.goto("/inbox");
    await page.getByTestId("inbox-ticket").first().click();
    await expect(page.getByTestId("inbox-timeline")).toBeVisible();

    await page.getByTestId("inbox-reply").fill("We are on it now.");
    await page.getByTestId("inbox-send").click();

    await expect(page.getByTestId("inbox-timeline")).toContainText(
      "We are on it now.",
    );
    expect(posted).toMatchObject({
      body: "We are on it now.",
      visibility: "CUSTOMER_VISIBLE",
    });
  });

  test("passes WCAG contrast in the light theme", async ({ page }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1*", (route) =>
      route.fulfill(json(timeline)),
    );

    await page.goto("/inbox");
    await page.getByRole("button", { name: "Toggle Theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByTestId("inbox-ticket").first().click();
    await expect(page.getByTestId("inbox-timeline")).toBeVisible();
    await expect(page.getByTestId("inbox-internal-note")).toBeVisible();

    await expectNoSeriousA11yViolations(page, "agent inbox light theme");
  });

  test("timeline renders messages and a stale status update surfaces a conflict", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1*", (route) =>
      route.fulfill(json(timeline)),
    );
    // AC-F05-2: the server refuses the stale write with 409.
    await page.route("**/tickets/ticket-1*", (route) =>
      route.fulfill(json({ message: "Stale ticket version" }, 409)),
    );

    await page.goto("/inbox");
    await page.getByTestId("inbox-ticket").first().click();

    // TH-05 at the UI: the timeline shows what the API serialized.
    await expect(page.getByTestId("inbox-timeline")).toBeVisible();
    const items = page.getByTestId("inbox-timeline").locator("li");
    await expect(items).toHaveCount(3);
    await expect(page.getByTestId("inbox-internal-note")).toBeVisible();

    await page.getByTestId("inbox-status-RESOLVED").click();
    await expect(page.getByTestId("inbox-conflict")).toBeVisible();
    await expect(page.getByTestId("inbox-conflict")).toContainText(
      "Stale ticket version",
    );

    // NFR-08: the agent workspace with a rendered timeline.
    await expectNoSeriousA11yViolations(page, "agent inbox timeline");
  });
});
