// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Screenshot regression checks for the administrator layouts.
 *
 * Six full-page images: dashboard, user directory and inbox at 1280×900 and
 * 390×844. Time is fixed, API responses are deterministic, and the WebGL
 * particle canvas is hidden. The background grid and every layout surface
 * remain visible, so spacing, wrapping and hierarchy changes fail the check.
 */

const SESSION_KEY = "velaris.auth.session.v1";
const FIXED_TIME = new Date("2026-11-13T10:00:00.000Z");

const session = {
  accessToken: "visual-regression-token",
  refreshToken: "visual-regression-refresh",
  expiresAt: 0,
  email: "admin@acme.test",
};

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-visual",
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

const members = [
  [
    "membership-1",
    "user-1",
    "admin@acme.test",
    "Acme Admin",
    "ACTIVE",
    "R-enterprise-admin",
  ],
  [
    "membership-2",
    "user-2",
    "maya.chen@acme.test",
    "Maya Chen",
    "ACTIVE",
    "R-tenant-admin",
  ],
  [
    "membership-3",
    "user-3",
    "liam.oconnor@acme.test",
    "Liam O'Connor",
    "ACTIVE",
    "R-agent",
  ],
  [
    "membership-4",
    "user-4",
    "priya.raman@acme.test",
    "Priya Raman",
    "ACTIVE",
    "R-agent",
  ],
  [
    "membership-5",
    "user-5",
    "noah.williams@acme.test",
    "Noah Williams",
    "SUSPENDED",
    "R-agent",
  ],
  [
    "membership-6",
    "user-6",
    "sophia.martin@acme.test",
    "Sophia Martin",
    "ACTIVE",
    "R-customer",
  ],
  [
    "membership-7",
    "user-7",
    "ethan.brown@acme.test",
    "Ethan Brown",
    "ACTIVE",
    "R-agent",
  ],
  [
    "membership-8",
    "user-8",
    "ava.wilson@acme.test",
    "Ava Wilson",
    "ACTIVE",
    "R-customer",
  ],
].map(([membershipId, userId, email, displayName, status, role]) => ({
  membershipId,
  userId,
  email,
  displayName,
  status,
  roles: [role],
}));

const auditEvents = [
  [
    "event-1",
    "ticket.updated",
    "ticket",
    "ticket-1",
    "req-abc",
    "2026-11-13T09:42:00.000Z",
  ],
  [
    "event-2",
    "retention.policy_changed",
    "retention_policy",
    "TRANSCRIPTS",
    null,
    "2026-11-13T08:15:00.000Z",
  ],
  [
    "event-3",
    "membership.role_changed",
    "membership",
    "membership-4",
    "req-def",
    "2026-11-12T16:20:00.000Z",
  ],
  [
    "event-4",
    "ai.trace.completed",
    "ai_trace",
    "trace-1",
    "req-ghi",
    "2026-11-12T15:58:00.000Z",
  ],
].map(
  ([id, action, resourceType, resourceId, requestId, createdAt], index) => ({
    id,
    actorId: index === 1 ? null : "user-1",
    action,
    resourceType,
    resourceId,
    requestId,
    createdAt,
  }),
);

const tickets = [
  [
    "ticket-1",
    "customer-1",
    "Refund not received after cancellation",
    "OPEN",
    "HIGH",
    0,
  ],
  [
    "ticket-2",
    "customer-2",
    "Cannot export the monthly usage report",
    "OPEN",
    "LOW",
    1,
  ],
  [
    "ticket-3",
    "customer-3",
    "Seat count is wrong after renewal",
    "IN_PROGRESS",
    "MEDIUM",
    2,
  ],
].map(([id, customerId, title, status, priority, index]) => ({
  id,
  customerId,
  title,
  status,
  priority,
  version: 1,
  assigneeMembershipId: Number(index) < 2 ? "membership-1" : null,
  updatedAt: new Date(
    FIXED_TIME.getTime() - Number(index) * 7 * 60_000,
  ).toISOString(),
}));

const conversations = [
  {
    id: "conv-1",
    customerId: "customer-1",
    channel: "email",
    status: "OPEN",
    version: 0,
  },
];

const timeline = {
  ...conversations[0],
  messages: [
    {
      id: "msg-1",
      body: "I cancelled my subscription eight days ago, but the refund has not arrived. Can you check the status?",
      authorType: "CUSTOMER",
      visibility: "CUSTOMER_VISIBLE",
      createdAt: "2026-11-13T09:10:00.000Z",
    },
    {
      id: "msg-2",
      body: "Payment provider confirms the refund was submitted. Follow up if it is not settled by Friday.",
      authorType: "AGENT",
      visibility: "INTERNAL",
      createdAt: "2026-11-13T09:25:00.000Z",
    },
    {
      id: "msg-3",
      body: "We have confirmed the refund with our payment provider. It should appear within three business days.",
      authorType: "AGENT",
      visibility: "CUSTOMER_VISIBLE",
      createdAt: "2026-11-13T09:31:00.000Z",
    },
  ],
};

const customer = {
  id: "customer-1",
  displayName: "Jordan Ellis",
  email: "jordan.ellis@northstar.test",
  phone: "+1 415 555 0128",
  status: "ACTIVE",
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function prepare(page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(session)],
  );
  await page.clock.setFixedTime(FIXED_TIME);

  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionResponse)),
  );
  await page.route("**/tenants/*/users*", (route) =>
    route.fulfill(json(members)),
  );
  await page.route("**/audit/events*", (route) =>
    route.fulfill(json({ items: auditEvents, limit: 8, hasMore: false })),
  );
  await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
  await page.route("**/conversations?*", (route) =>
    route.fulfill(json(conversations)),
  );
  await page.route("**/conversations/conv-1*", (route) =>
    route.fulfill(json(timeline)),
  );
  await page.route("**/customers/*", (route) => route.fulfill(json(customer)));
}

async function removeDynamicSurface(page) {
  await page.addStyleTag({
    content: `
      canvas { visibility: hidden !important; }
      * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function capture(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}

test.describe("administrator visual layouts", () => {
  test("dashboard at desktop and mobile widths", async ({ page }) => {
    await prepare(page);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-audit-event")).toHaveCount(4);

    await removeDynamicSurface(page);
    await capture(page, "dashboard-desktop.png", 1280, 900);

    await capture(page, "dashboard-mobile.png", 390, 844);
    await expect(page.getByLabel("Toggle Navigation")).toBeVisible();
  });

  test("user directory at desktop and mobile widths", async ({ page }) => {
    await prepare(page);
    await page.goto("/admin");
    await page.getByRole("button", { name: "User Directory" }).click();
    await expect(page.getByTestId("tenant-user-row")).toHaveCount(8);

    await removeDynamicSurface(page);
    await capture(page, "directory-desktop.png", 1280, 900);

    await capture(page, "directory-mobile.png", 390, 844);
    await expect(
      page.getByTestId("tenant-user-status-mobile").first(),
    ).toBeVisible();
  });

  test("inbox at desktop and mobile widths", async ({ page }) => {
    await prepare(page);
    await page.goto("/inbox");
    await page.getByTestId("inbox-ticket").first().click();
    await expect(page.getByTestId("inbox-timeline")).toBeVisible();
    await expect(page.getByTestId("inbox-profile")).toBeVisible();

    await removeDynamicSurface(page);
    await capture(page, "inbox-desktop.png", 1280, 900);

    await capture(page, "inbox-mobile.png", 390, 844);
    await expect(page.getByLabel("Toggle Navigation")).toBeVisible();
  });
});
