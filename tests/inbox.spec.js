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

const assignees = [
  {
    membershipId: "membership-1",
    userId: "user-1",
    displayName: "Avery Agent",
    email: "agent@example.test",
    roles: ["R-agent"],
  },
  {
    membershipId: "membership-2",
    userId: "user-2",
    displayName: "Maya Chen",
    email: "maya.chen@example.test",
    roles: ["R-agent"],
  },
  {
    membershipId: "membership-3",
    userId: "user-3",
    displayName: "Riley Admin",
    email: "riley@example.test",
    roles: ["R-tenant-admin"],
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

  test("assigns a ticket to an eligible agent and shows the new assignee", async ({
    page,
  }) => {
    let assignmentBody = null;
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
    await page.route("**/tickets/assignees*", (route) =>
      route.fulfill(json(assignees)),
    );
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1*", (route) =>
      route.fulfill(json(timeline)),
    );
    await page.route("**/tickets/ticket-1*", (route) => {
      assignmentBody = route.request().postDataJSON();
      return route.fulfill(
        json({
          ...tickets[0],
          assigneeMembershipId: "membership-2",
          version: 1,
        }),
      );
    });

    await page.goto("/inbox");
    await page.getByTestId("inbox-ticket").first().click();
    await expect(page.getByTestId("inbox-timeline")).toBeVisible();

    await page.getByTestId("inbox-assignee").selectOption("membership-2");
    await page.getByTestId("inbox-assign").click();

    await expect(page.getByTestId("inbox-assignment")).toBeVisible();
    await expect(page.getByTestId("inbox-copilot")).toContainText("Maya Chen");
    expect(assignmentBody).toMatchObject({
      assigneeMembershipId: "membership-2",
      expectedVersion: 0,
    });
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
    const screenshot = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
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
            metadataJson: posted.attachments
              ? { attachments: posted.attachments }
              : null,
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
    await page.getByTestId("inbox-attach-input").setInputFiles({
      name: "screen.png",
      mimeType: "image/png",
      buffer: screenshot,
    });
    await expect(page.getByTestId("inbox-attachment-list")).toContainText(
      "screen.png",
    );
    await page.getByTestId("inbox-send").click();

    await expect(page.getByTestId("inbox-timeline")).toContainText(
      "We are on it now.",
    );
    expect(posted).toMatchObject({
      body: "We are on it now.",
      visibility: "CUSTOMER_VISIBLE",
    });
    expect(posted.attachments).toEqual([
      expect.objectContaining({
        name: "screen.png",
        type: "image/png",
        size: screenshot.length,
      }),
    ]);
    await expect(page.getByTestId("inbox-attachment-image")).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
  });

  test("shows the linked conversation's first message as the ticket description", async ({
    page,
  }) => {
    const linkedTimeline = {
      id: "conv-linked",
      customerId: "customer-1",
      channel: "web",
      status: "OPEN",
      version: 0,
      createdAt: "2026-11-20T09:00:00Z",
      messages: [
        {
          id: "msg-desc",
          body: "Exporting November invoices returns a blank file.",
          authorType: "CUSTOMER",
          visibility: "CUSTOMER_VISIBLE",
          createdAt: "2026-11-20T09:00:00Z",
        },
      ],
    };
    const requests = [];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json([
          { ...tickets[0], primaryConversationId: "conv-linked" },
          tickets[1],
        ]),
      ),
    );
    await page.route("**/tickets/assignees*", (route) =>
      route.fulfill(json(assignees)),
    );
    // The customer has an older conversation too; the link must win.
    await page.route("**/conversations?*", (route) => {
      requests.push(route.request().url());
      return route.fulfill(json(conversations));
    });
    await page.route("**/conversations/conv-linked?*", (route) => {
      requests.push(route.request().url());
      return route.fulfill(json(linkedTimeline));
    });

    await page.goto("/inbox");
    await page.getByTestId("inbox-ticket").first().click();

    await expect(page.getByTestId("inbox-ticket-description")).toContainText(
      "Exporting November invoices returns a blank file.",
    );
    await expect(page.getByTestId("inbox-timeline")).toContainText(
      "Exporting November invoices returns a blank file.",
    );
    expect(requests.some((url) => url.includes("conv-linked"))).toBe(true);
    expect(requests.some((url) => url.includes("conv-1"))).toBe(false);
  });

  test("shows a customer description preview in the queue row for triage", async ({
    page,
  }) => {
    const preview =
      "Exporting November invoices returns a blank file every time.";
    const conversationRequests = [];

    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets/assignees*", (route) =>
      route.fulfill(json(assignees)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json([
          {
            ...tickets[0],
            primaryConversationId: "conv-linked",
            descriptionPreview: preview,
          },
          tickets[1],
        ]),
      ),
    );
    await page.route("**/conversations**", (route) => {
      conversationRequests.push(route.request().url());
      return route.fulfill(
        json({
          ...conversations[0],
          id: "conv-linked",
          messages: [
            {
              id: "msg-preview",
              body: preview,
              authorType: "CUSTOMER",
              visibility: "CUSTOMER_VISIBLE",
              createdAt: "2026-11-20T09:00:00Z",
            },
          ],
        }),
      );
    });

    await page.goto("/inbox");

    const rows = page.getByTestId("inbox-ticket");
    await expect(rows).toHaveCount(2);
    // The linked ticket carries its customer's first words in the queue...
    await expect(rows.first().getByTestId("inbox-ticket-preview")).toHaveText(
      preview,
    );
    // ...while a ticket with no linked conversation shows no preview line.
    await expect(rows.nth(1).getByTestId("inbox-ticket-preview")).toHaveCount(
      0,
    );
    // Triage needs no thread: the queue row alone answers "what is this?"
    expect(conversationRequests).toEqual([]);

    // Opening the same ticket still shows the full description in the detail
    // pane, so the preview is a summary and never the only copy.
    await rows.first().click();
    await expect(page.getByTestId("inbox-ticket-description")).toContainText(
      preview,
    );
  });

  test("finds a ticket by the customer's own words in the description preview", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets/assignees*", (route) =>
      route.fulfill(json(assignees)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json([
          {
            ...tickets[0],
            primaryConversationId: "conv-linked",
            descriptionPreview:
              "Exporting November invoices returns a blank file.",
          },
          {
            ...tickets[1],
            primaryConversationId: "conv-other",
            descriptionPreview: "The password reset email never arrives.",
          },
        ]),
      ),
    );

    await page.goto("/inbox");

    const rows = page.getByTestId("inbox-ticket");
    const search = page.getByTestId("inbox-search");
    await expect(rows).toHaveCount(2);

    // Neither subject contains the phrase; only the preview does.
    await search.fill("blank file");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Refund not received");
    await expect(
      rows.first().getByTestId("inbox-ticket-preview"),
    ).toContainText("blank file");

    await search.fill("password reset");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Other customer ticket");

    // The subject and the id still match, and clearing shows all rows again.
    await search.fill("Refund");
    await expect(rows).toHaveCount(1);
    await search.fill("");
    await expect(rows).toHaveCount(2);
  });

  test("filters the queue by status so resolved and closed tickets stay out of triage", async ({
    page,
  }) => {
    const triageTickets = [
      { ...tickets[0], status: "OPEN" },
      { ...tickets[1], status: "IN_PROGRESS" },
      {
        ...tickets[1],
        id: "ticket-3",
        title: "Refund settled last week",
        status: "RESOLVED",
        version: 4,
      },
      {
        ...tickets[1],
        id: "ticket-4",
        title: "Closed billing question",
        status: "CLOSED",
        version: 5,
      },
    ];

    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(json(triageTickets)),
    );

    await page.goto("/inbox");

    const rows = page.getByTestId("inbox-ticket");
    const status = page.getByTestId("inbox-status");
    // One page holds the whole fixture, so each count is the filter's result.
    await page.getByTestId("inbox-rows").selectOption("5");

    // Active work is the default: open and in-progress rows stay, so a
    // resolved or closed ticket cannot crowd triage.
    await expect(status).toHaveValue("ACTIVE");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("inbox-count")).toHaveText("2");
    await expect(rows.nth(1)).toContainText("Other customer ticket");

    // Each status stays reachable, so a resolved ticket can be reopened.
    await status.selectOption("RESOLVED");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Refund settled last week");
    await expect(page.getByTestId("inbox-count")).toHaveText("1");

    await status.selectOption("CLOSED");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Closed billing question");

    // All Status restores the full list.
    await status.selectOption("ALL");
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId("inbox-count")).toHaveText("4");

    // The status and priority filters compose.
    await page.getByTestId("inbox-priority").selectOption("HIGH");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Refund not received");
  });

  test("highlights the matched text in a search result", async ({ page }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json([
          {
            ...tickets[0],
            primaryConversationId: "conv-linked",
            descriptionPreview:
              "Exporting November invoices returns a blank file.",
          },
          {
            ...tickets[1],
            primaryConversationId: "conv-other",
            descriptionPreview: "The password reset email never arrives.",
          },
        ]),
      ),
    );

    await page.goto("/inbox");

    const rows = page.getByTestId("inbox-ticket");
    const search = page.getByTestId("inbox-search");
    const marks = page.getByTestId("inbox-match");

    // A description match highlights the customer's words in the preview.
    await search.fill("blank file");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("inbox-match")).toHaveCount(1);
    await expect(rows.first().getByTestId("inbox-match")).toHaveText(
      "blank file",
    );
    await expect(
      rows.first().getByTestId("inbox-ticket-preview"),
    ).toContainText("Exporting November invoices returns a blank file.");

    // Matching ignores case, and the highlight keeps the original spelling.
    await search.fill("BLANK FILE");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("inbox-match")).toHaveText(
      "blank file",
    );

    // A subject match highlights the title instead.
    await search.fill("refund");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("inbox-match")).toHaveText("Refund");

    // Clearing the box removes every highlight and restores the queue.
    await search.fill("");
    await expect(marks).toHaveCount(0);
    await expect(rows).toHaveCount(2);
  });

  test("offers the composer when a ticket has no conversation yet", async ({
    page,
  }) => {
    let createdConversation = null;
    let posted = null;
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/tickets*", (route) => route.fulfill(json(tickets)));
    await page.route("**/conversations?*", (route) => {
      if (route.request().method() === "POST") {
        createdConversation = route.request().postDataJSON();
        return route.fulfill(
          json(
            {
              id: "conv-new",
              customerId: createdConversation.customerId,
              status: "OPEN",
              channel: createdConversation.channel,
            },
            201,
          ),
        );
      }
      return route.fulfill(json([]));
    });
    await page.route("**/conversations/conv-new**", (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill(
        json({
          id: "msg-new",
          body: posted.body,
          authorType: "AGENT",
          visibility: posted.visibility,
          createdAt: "2026-11-15T10:00:00Z",
        }),
      );
    });

    await page.goto("/inbox");
    await page.getByTestId("inbox-ticket").first().click();
    await expect(page.getByTestId("inbox-timeline-empty")).toBeVisible();
    await expect(page.getByTestId("inbox-reply")).toBeVisible();
    await page.getByTestId("inbox-reply").fill("Starting from this ticket.");
    await page.getByTestId("inbox-send").click();

    await expect(page.getByTestId("inbox-timeline")).toContainText(
      "Starting from this ticket.",
    );
    expect(createdConversation).toMatchObject({ channel: "WEB" });
    expect(posted).toMatchObject({
      body: "Starting from this ticket.",
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
