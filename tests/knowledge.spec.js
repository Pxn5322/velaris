// @ts-check
import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Journey J-05 / T3.05 verify: the knowledge source tab.
 *
 * Maps to AC-F07-1 (ingestion status and provenance are readable) and
 * AC-F07-2 (a failure is reported and retry is possible), plus the
 * explicit loading / empty / failure / denial states of the panel.
 *
 * Every API call is intercepted with page.route: the CI runner has no
 * database. The panel lives in the existing "3. Knowledge" tab of the
 * studio — no new tab is created.
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

const readySource = {
  id: "src-ready",
  tenantId: "tenant-a",
  sourceType: "WEBSITE",
  sourceUri: "https://docs.example.test/runbook",
  objectKey: null,
  status: "READY",
  contentHash: "a".repeat(64),
  provenanceJson: { sourceUri: "https://docs.example.test/runbook" },
  errorCode: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:05:00.000Z",
};

const failedSource = {
  id: "src-failed",
  tenantId: "tenant-a",
  sourceType: "WEBSITE",
  sourceUri: "https://broken.example.test/page",
  objectKey: null,
  status: "FAILED",
  contentHash: "b".repeat(64),
  provenanceJson: { sourceUri: "https://broken.example.test/page" },
  errorCode: "FETCH_FAILED",
  createdAt: "2026-10-21T09:00:00.000Z",
  updatedAt: "2026-10-21T09:01:00.000Z",
};

const retriedSource = {
  ...failedSource,
  status: "PENDING",
  errorCode: null,
  updatedAt: "2026-10-22T09:00:00.000Z",
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

async function openKnowledgeTab(page) {
  await page.goto("/studio");
  await page.getByRole("button", { name: "3. Knowledge" }).click();
}

test.describe("knowledge sources tab (T3.05, AC-F07)", () => {
  test("signed out, the studio redirects to the landing sign-in modal", async ({
    page,
  }) => {
    await page.goto("/studio");

    await expect(page).toHaveURL(/\?signin=1/);
    await expect(
      page.getByRole("heading", { name: "Sign In to VELARIS" }),
    ).toBeVisible();
  });

  test("shows the loading state before sources arrive (AC-F07-1)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/knowledge-sources*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill(json([readySource]));
    });

    await openKnowledgeTab(page);
    await expect(page.getByTestId("knowledge-loading")).toBeVisible();
    await expect(page.getByTestId("knowledge-source")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows the empty state when the tenant has no sources", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/knowledge-sources*", (route) =>
      route.fulfill(json([])),
    );

    await openKnowledgeTab(page);
    await expect(page.getByTestId("knowledge-empty")).toBeVisible();
  });

  test("shows the error state with retry when the API fails", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/knowledge-sources*", (route) =>
      route.fulfill(json({ message: "Internal error" }, 500)),
    );

    await openKnowledgeTab(page);
    await expect(page.getByTestId("knowledge-error")).toBeVisible();

    await page.route("**/knowledge-sources*", (route) =>
      route.fulfill(json([readySource])),
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("knowledge-source")).toHaveCount(1);
  });

  test("failed source reports the error and a retry resubmits it (AC-F07-2)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/knowledge-sources*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill(json(retriedSource, 201));
        return;
      }
      await route.fulfill(json([failedSource]));
    });

    await openKnowledgeTab(page);
    await expect(page.getByTestId("knowledge-status-FAILED")).toBeVisible();

    // Ingestion detail: status, error code and provenance are readable.
    await page.getByTestId("knowledge-source").first().click();
    await expect(page.getByTestId("knowledge-detail-status")).toHaveText(
      "FAILED",
    );
    await expect(page.getByTestId("knowledge-failure")).toContainText(
      "FETCH_FAILED",
    );
    await expect(page.getByTestId("knowledge-retry-source")).toBeVisible();

    // NFR-08: the knowledge view with a failed source and its retry.
    await expectNoSeriousA11yViolations(page, "knowledge source detail");

    // Retry resubmits the original reference and the row restarts as PENDING.
    await page.getByTestId("knowledge-retry-source").click();
    await expect(page.getByTestId("knowledge-status-PENDING")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("knowledge-detail-status")).toHaveText(
      "PENDING",
    );
  });

  test("lists sources with their status badges (AC-F07-1)", async ({
    page,
  }) => {
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/knowledge-sources*", (route) =>
      route.fulfill(json([readySource, failedSource])),
    );

    await openKnowledgeTab(page);
    await expect(page.getByTestId("knowledge-source")).toHaveCount(2);
    await expect(page.getByTestId("knowledge-status-READY")).toBeVisible();
    await expect(page.getByTestId("knowledge-status-FAILED")).toBeVisible();
    await expect(page.getByTestId("knowledge-list")).toContainText(
      "https://docs.example.test/runbook",
    );
  });

  test("creates, updates and deletes a knowledge source", async ({ page }) => {
    const calls = [];
    let current = [readySource];
    await seedSession(page);
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/knowledge-sources**", (route) => {
      const request = route.request();
      const method = request.method();
      const body =
        method === "GET" || method === "DELETE" ? null : request.postDataJSON();
      calls.push({ method, body });
      if (method === "GET") return route.fulfill(json(current));
      if (method === "POST") {
        const created = {
          id: "src-created",
          tenantId: "tenant-a",
          sourceType: body.sourceType,
          sourceUri: body.sourceUri ?? null,
          objectKey: body.objectKey ?? null,
          status: "PENDING",
          contentHash: "c".repeat(64),
          provenanceJson: body.content ? { content: body.content } : {},
          errorCode: null,
          createdAt: "2026-11-15T10:00:00.000Z",
          updatedAt: "2026-11-15T10:00:00.000Z",
        };
        current = [created, ...current];
        return route.fulfill(json(created, 201));
      }
      if (method === "PATCH") {
        const id = request.url().split("/knowledge-sources/")[1].split("?")[0];
        const updated = {
          ...current.find((row) => row.id === id),
          ...body,
          provenanceJson: body.content ? { content: body.content } : {},
          status: "PENDING",
          updatedAt: "2026-11-15T10:05:00.000Z",
        };
        current = current.map((row) => (row.id === id ? updated : row));
        return route.fulfill(json(updated));
      }
      const id = request.url().split("/knowledge-sources/")[1].split("?")[0];
      current = current.filter((row) => row.id !== id);
      return route.fulfill(json({ id, deleted: true }));
    });

    await openKnowledgeTab(page);
    await page.getByTestId("knowledge-create-open").click();
    await page.getByTestId("knowledge-form-type").selectOption("MANUAL");
    await page
      .getByTestId("knowledge-form-content")
      .fill("Escalate billing disputes to the finance queue.");
    await page.getByTestId("knowledge-form-submit").click();

    await expect(page.getByTestId("knowledge-notice")).toContainText(
      "Knowledge source added",
    );
    await expect(page.getByTestId("knowledge-source")).toHaveCount(2);
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      sourceType: "MANUAL",
      content: "Escalate billing disputes to the finance queue.",
    });

    await page
      .getByTestId("knowledge-source")
      .filter({ hasText: "Escalate billing disputes" })
      .click();
    await page.getByTestId("knowledge-edit-source").click();
    await page
      .getByTestId("knowledge-form-content")
      .fill("Escalate billing disputes to the finance and legal queues.");
    await page.getByTestId("knowledge-form-submit").click();
    await expect(page.getByTestId("knowledge-notice")).toContainText(
      "Knowledge source updated",
    );
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      content: "Escalate billing disputes to the finance and legal queues.",
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("knowledge-delete-source").click();
    await expect(page.getByTestId("knowledge-source")).toHaveCount(1);
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });
});
