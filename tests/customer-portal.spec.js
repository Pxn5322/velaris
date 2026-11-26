// @ts-check
import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Journey J-03 / T2.04: customer portal sign-in and conversation timeline.
 *
 * Maps to AC-F05-1 (customer reads their conversation) and AC-F06-3
 * denial behavior. All Supabase Auth and API calls are intercepted with
 * page.route; the stored session is injected exactly as the auth
 * library writes it, so no real service is contacted.
 */

const SESSION_KEY = "velaris.auth.session.v1";

const session = {
  accessToken: "e2e-customer-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "buyer@example.test",
};

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-customer",
    email: "buyer@example.test",
  },
  tenantContext: {
    userId: "user-customer",
    tenants: [
      {
        tenantId: "tenant-a",
        slug: "acme",
        name: "Acme",
        membershipId: "membership-customer",
      },
    ],
  },
  role: "R-customer",
};

const conversations = [
  {
    id: "conv-1",
    customerId: "customer-1",
    channel: "email",
    status: "OPEN",
    version: 2,
    createdAt: "2026-10-21T09:00:00Z",
  },
];

const timeline = {
  ...conversations[0],
  messages: [
    {
      id: "msg-1",
      body: "Hello, I need help with my order.",
      authorType: "CUSTOMER",
      visibility: "CUSTOMER_VISIBLE",
      createdAt: "2026-10-21T09:00:00Z",
    },
    {
      id: "msg-2",
      body: "We are on it, checking with logistics.",
      authorType: "AGENT",
      visibility: "CUSTOMER_VISIBLE",
      createdAt: "2026-10-21T09:05:00Z",
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

test.describe("customer portal (J-03)", () => {
  test("redirects a signed-out visitor to the main sign-in", async ({
    page,
  }) => {
    await page.goto("/portal/conversations");
    await expect(page).toHaveURL(/\?signin=1/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Sign In to VELARIS" }),
    ).toBeVisible();
  });

  test("sign-in refuses bad credentials with a visible error", async ({
    page,
  }) => {
    await page.route("**/auth/v1/token*", (route) =>
      route.fulfill(json({ msg: "Invalid login credentials" }, 400)),
    );

    await page.goto("/portal/sign-in");
    await expect(page.getByTestId("sign-in-form")).toBeVisible();
    await page.getByTestId("sign-in-email").fill("buyer@example.test");
    await page.getByTestId("sign-in-password").fill("wrong-password");
    await page.getByTestId("sign-in-submit").click();
    await expect(page.getByTestId("sign-in-error")).toBeVisible();
    await expect(page.getByTestId("sign-in-error")).toContainText(
      "Invalid login",
    );
    // No redirect on failure.
    await expect(page).toHaveURL(/\/portal\/sign-in/);

    // NFR-08: the sign-in form announces its error and stays labelled.
    await expectNoSeriousA11yViolations(page, "portal sign-in error");
  });

  test("sign-in validates an empty form before any request", async ({
    page,
  }) => {
    await page.goto("/portal/sign-in");
    await page.getByTestId("sign-in-submit").click();
    await expect(page.getByTestId("sign-in-error")).toContainText(
      "email and password",
    );
  });

  test("sign-in succeeds and lands on the conversation timeline", async ({
    page,
  }) => {
    let tokenCalls = 0;
    await page.route("**/auth/v1/token*", (route) => {
      tokenCalls += 1;
      route.fulfill(
        json({
          access_token: "e2e-customer-token",
          refresh_token: "e2e-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { email: "buyer@example.test" },
        }),
      );
    });
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1*", (route) =>
      route.fulfill(json(timeline)),
    );

    await page.goto("/portal/sign-in");
    await page.getByTestId("sign-in-email").fill("buyer@example.test");
    await page.getByTestId("sign-in-password").fill("correct-password");
    await page.getByTestId("sign-in-submit").click();

    await expect(page).toHaveURL(/\/portal\/conversations/);
    expect(tokenCalls).toBe(1);
    await expect(page.getByTestId("portal-conversation")).toHaveCount(1);
    await page.getByTestId("portal-conversation").click();
    await expect(page.getByTestId("portal-timeline")).toBeVisible();
    await expect(page.getByTestId("portal-timeline")).toContainText(
      "We are on it, checking with logistics.",
    );
    // The API serialized the customer view: two visible messages, and the
    // customer page never renders an internal-note marker.
    await expectNoSeriousA11yViolations(page, "customer portal timeline");
    await expect(page.getByTestId("portal-timeline").locator("li")).toHaveCount(
      2,
    );
  });

  test("the customer asks a question and the assistant answers (J-03, API-13)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1/messages*", (route) =>
      route.fulfill(
        json(
          {
            id: "msg-3",
            body: "Where is my refund?",
            authorType: "CUSTOMER",
            visibility: "CUSTOMER_VISIBLE",
            createdAt: "2026-10-21T09:10:00Z",
            ai: {
              outcome: "respond",
              reason: "grounded",
              reply: {
                id: "msg-4",
                body: "Your refund reached your account on Monday.",
                citationCount: 2,
              },
              handoff: null,
            },
          },
          201,
        ),
      ),
    );
    await page.route("**/conversations/conv-1?*", (route) =>
      route.fulfill(json(timeline)),
    );

    await page.goto("/portal/conversations");
    await page.getByTestId("portal-conversation").click();
    await expect(page.getByTestId("portal-timeline")).toBeVisible();

    await page.getByTestId("portal-reply-body").fill("Where is my refund?");
    await page.getByTestId("portal-reply-submit").click();

    await expect(page.getByTestId("portal-timeline")).toContainText(
      "Where is my refund?",
    );
    await expect(page.getByTestId("portal-timeline")).toContainText(
      "Your refund reached your account on Monday.",
    );
    await expect(page.getByTestId("portal-ai-notice")).toHaveText(
      "Answered from 2 knowledge sources.",
    );
    await expect(page.getByTestId("portal-reply-body")).toHaveValue("");
    await expectNoSeriousA11yViolations(page, "portal reply answered");
  });

  test("an unanswered question asks for a human instead of inventing a reply", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1/messages*", (route) =>
      route.fulfill(
        json(
          {
            id: "msg-5",
            body: "Do you support Martian deliveries?",
            authorType: "CUSTOMER",
            visibility: "CUSTOMER_VISIBLE",
            createdAt: "2026-10-21T09:12:00Z",
            ai: {
              outcome: "abstain",
              reason: "no_relevant_knowledge",
              reply: null,
              handoff: { reason: "no_relevant_knowledge", retrievedCount: 0 },
            },
          },
          201,
        ),
      ),
    );
    await page.route("**/conversations/conv-1?*", (route) =>
      route.fulfill(json(timeline)),
    );

    await page.goto("/portal/conversations");
    await page.getByTestId("portal-conversation").click();
    await expect(page.getByTestId("portal-timeline")).toBeVisible();

    await page
      .getByTestId("portal-reply-body")
      .fill("Do you support Martian deliveries?");
    await page.getByTestId("portal-reply-submit").click();

    await expect(page.getByTestId("portal-ai-notice")).toHaveText(
      "A teammate will follow up on this question.",
    );
    // No answer row was added: three items are the question plus the two
    // seeded messages, so the assistant said nothing rather than guessing.
    await expect(page.getByTestId("portal-timeline").locator("li")).toHaveCount(
      3,
    );
  });

  test("a denied reply shows an error and keeps the draft", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json(conversations)),
    );
    await page.route("**/conversations/conv-1/messages*", (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );
    await page.route("**/conversations/conv-1?*", (route) =>
      route.fulfill(json(timeline)),
    );

    await page.goto("/portal/conversations");
    await page.getByTestId("portal-conversation").click();
    await page.getByTestId("portal-reply-body").fill("Are you there?");
    await page.getByTestId("portal-reply-submit").click();

    await expect(page.getByTestId("portal-reply-error")).toHaveText(
      "Your account cannot reply in this conversation.",
    );
    await expect(page.getByTestId("portal-reply-body")).toHaveValue(
      "Are you there?",
    );
  });

  test("the conversations list shows the empty state", async ({ page }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/conversations?*", (route) => route.fulfill(json([])));

    await page.goto("/portal/conversations");
    await expect(page.getByTestId("portal-empty")).toBeVisible();
    // Not a dead end: the empty state leads back to the composer that starts
    // a real conversation.
    await expect(page.getByTestId("portal-start-conversation")).toHaveAttribute(
      "href",
      "/portal",
    );
  });

  test("the conversations list shows the error state on API failure", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/conversations?*", (route) =>
      route.fulfill(json({ message: "boom" }, 500)),
    );

    await page.goto("/portal/conversations");
    await expect(page.getByTestId("portal-error")).toBeVisible();
  });

  test("the support page names the real tenant and lists its own tickets", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json({
          items: [
            {
              id: "ticket-1111",
              customerId: "customer-1",
              title: "Printer on floor 3 is offline",
              status: "OPEN",
              priority: "MEDIUM",
              tags: ["Hardware"],
              createdAt: "2026-11-20T08:00:00Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        }),
      ),
    );

    await page.goto("/portal");

    await expect(page.getByTestId("portal-tenant-heading")).toHaveText(
      "Welcome to Acme",
    );
    await expect(page.getByTestId("portal-ticket-title")).toHaveText(
      "Printer on floor 3 is offline",
    );
    await expect(page.getByTestId("portal-ticket-row")).toHaveCount(1);
    // The two demo rows of the old mock are gone.
    await expect(page.getByText("Unable to configure SAML 2.0")).toHaveCount(0);
    // One short page needs no pager, so the portal does not show one.
    await expect(page.getByTestId("portal-ticket-range")).toHaveCount(0);
    await expectNoSeriousA11yViolations(page, "customer support page");
  });

  test("the support page pages through requests past the first 25 (D-81)", async ({
    page,
  }) => {
    const requests = [];
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `ticket-${String(index + 1).padStart(4, "0")}`,
      customerId: "customer-1",
      title: `Request ${index + 1}`,
      status: "OPEN",
      priority: "MEDIUM",
      tags: ["General"],
      createdAt: "2026-11-20T08:00:00Z",
    }));

    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    // The stub answers like the server: one bounded page plus the total (D-81).
    await page.route(/\/tickets\?tenantId=/, (route) => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      const requested = Number(params.get("page") ?? "1");
      const size = Number(params.get("pageSize") ?? "25");
      const start = (requested - 1) * size;
      return route.fulfill(
        json({
          items: many.slice(start, start + size),
          total: many.length,
          page: requested,
          pageSize: size,
        }),
      );
    });

    await page.goto("/portal");

    const rows = page.getByTestId("portal-ticket-row");
    // The first read holds one page and names the total, so the rest is
    // reachable instead of silently missing.
    await expect(rows).toHaveCount(25);
    await expect(page.getByTestId("portal-ticket-range")).toHaveText(
      "1-25 of 30",
    );
    await expect(page.getByTestId("portal-prev-page")).toBeDisabled();

    await page.getByTestId("portal-next-page").click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId("portal-ticket-range")).toHaveText(
      "26-30 of 30",
    );
    await expect(page.getByTestId("portal-ticket-title").first()).toHaveText(
      "Request 26",
    );
    await expect(page.getByTestId("portal-ticket-title").last()).toHaveText(
      "Request 30",
    );
    await expect(page.getByTestId("portal-next-page")).toBeDisabled();

    // The later page came from the API; the browser did not slice a cache.
    await expect
      .poll(() => requests.some((params) => params.get("page") === "2"))
      .toBe(true);
    expect(requests.every((params) => params.get("pageSize") === "25")).toBe(
      true,
    );

    await page.getByTestId("portal-prev-page").click();
    await expect(rows).toHaveCount(25);
    await expect(page.getByTestId("portal-ticket-range")).toHaveText(
      "1-25 of 30",
    );
  });

  test("a submitted ticket is persisted by the API and survives a reload", async ({
    page,
  }) => {
    const stored = [];
    const posted = [];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tickets\/self\?tenantId=/, async (route) => {
      const body = route.request().postDataJSON();
      posted.push({ url: route.request().url(), body });
      const row = {
        id: "ticket-2222",
        customerId: "customer-1",
        title: body.title,
        status: "OPEN",
        priority: body.priority ?? "MEDIUM",
        tags: body.tags ?? [],
        createdAt: "2026-11-20T09:00:00Z",
      };
      stored.push(row);
      await route.fulfill(json(row, 201));
    });
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json({ items: stored, total: stored.length, page: 1, pageSize: 25 }),
      ),
    );

    await page.goto("/portal");
    await expect(page.getByTestId("portal-tickets-empty")).toBeVisible();

    await page.getByRole("button", { name: "Submit New Ticket" }).click();
    await page
      .getByTestId("portal-ticket-title-input")
      .fill("Cannot export my invoices");
    await page.getByTestId("portal-ticket-submit").click();

    await expect(page.getByTestId("portal-ticket-title")).toHaveText(
      "Cannot export my invoices",
    );
    expect(posted).toHaveLength(1);
    // The server derives the tenant and the customer, so the body carries
    // neither: a client cannot choose whose ticket it writes.
    expect(posted[0].url).toContain("tenantId=tenant-a");
    expect(posted[0].body).not.toHaveProperty("customerId");
    expect(posted[0].body).not.toHaveProperty("tenantId");
    // No description was typed, so no conversation was started and no
    // conversationId is sent.
    expect(posted[0].body).not.toHaveProperty("conversationId");

    await page.reload();
    await expect(page.getByTestId("portal-ticket-title")).toHaveText(
      "Cannot export my invoices",
    );
    await expect(page.getByTestId("portal-ticket-row")).toHaveCount(1);
  });

  test("a described ticket starts a real conversation and links it", async ({
    page,
  }) => {
    const conversationBodies = [];
    const ticketBodies = [];
    let stored = [];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/conversations\/self\?tenantId=/, async (route) => {
      conversationBodies.push(route.request().postDataJSON());
      await route.fulfill(
        json(
          {
            id: "conv-new",
            customerId: "customer-1",
            channel: "web",
            status: "OPEN",
            version: 0,
            createdAt: "2026-11-20T09:00:00Z",
          },
          201,
        ),
      );
    });
    await page.route(/\/tickets\/self\?tenantId=/, async (route) => {
      const body = route.request().postDataJSON();
      ticketBodies.push(body);
      const row = {
        id: "ticket-3333",
        customerId: "customer-1",
        title: body.title,
        status: "OPEN",
        priority: body.priority ?? "MEDIUM",
        tags: body.tags ?? [],
        primaryConversationId: body.conversationId ?? null,
        createdAt: "2026-11-20T09:00:00Z",
      };
      stored = [row];
      await route.fulfill(json(row, 201));
    });
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(
        json({ items: stored, total: stored.length, page: 1, pageSize: 25 }),
      ),
    );

    await page.goto("/portal");
    await page.getByRole("button", { name: "Submit New Ticket" }).click();
    await page
      .getByTestId("portal-ticket-title-input")
      .fill("Invoice export fails");
    await page
      .getByTestId("portal-ticket-description")
      .fill("Exporting November invoices returns a blank file.");
    await page.getByTestId("portal-ticket-submit").click();

    await expect(page.getByTestId("portal-ticket-title")).toContainText(
      "Invoice export fails",
    );
    expect(conversationBodies).toHaveLength(1);
    expect(conversationBodies[0]).toMatchObject({
      channel: "web",
      body: "Exporting November invoices returns a blank file.",
    });
    expect(ticketBodies).toHaveLength(1);
    // The ticket carries the description by pointing at the thread that
    // stored it, not by inventing a column the schema does not have.
    expect(ticketBodies[0].conversationId).toBe("conv-new");
    await expect(page.getByTestId("portal-ticket-conversation")).toHaveAttribute(
      "href",
      "/portal/conversations",
    );
    await expect(page.getByTestId("portal-conversations-link")).toHaveAttribute(
      "href",
      "/portal/conversations",
    );
  });

  test("a rejected submission keeps the form open and adds no row", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route(/\/tickets\/self\?tenantId=/, (route) =>
      route.fulfill(json({ message: "Forbidden" }, 403)),
    );
    await page.route(/\/tickets\?tenantId=/, (route) =>
      route.fulfill(json({ items: [], total: 0, page: 1, pageSize: 25 })),
    );

    await page.goto("/portal");
    await page.getByRole("button", { name: "Submit New Ticket" }).click();
    await page.getByTestId("portal-ticket-title-input").fill("Denied request");
    await page.getByTestId("portal-ticket-submit").click();

    await expect(page.getByTestId("portal-ticket-error")).toBeVisible();
    await expect(page.getByTestId("portal-ticket-error")).toContainText(
      "cannot open a support request",
    );
    await expect(page.getByTestId("portal-ticket-title-input")).toHaveValue(
      "Denied request",
    );
    await page.getByTestId("portal-ticket-cancel").click();
    await expect(page.getByTestId("portal-tickets-empty")).toBeVisible();
    await expect(page.getByTestId("portal-ticket-row")).toHaveCount(0);
  });
});
