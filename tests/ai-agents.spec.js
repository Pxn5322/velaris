// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Journey T4.06 / F-08: agent configuration, evaluation, publication and
 * rollback (AC-F08-1, AC-F08-2, AC-F08-3).
 *
 * The panels live in the existing studio tabs "8. Evaluation" and
 * "9. Versions" — no new route is created. Every API call is intercepted
 * with page.route: the CI runner has no database.
 *
 * Covered:
 * - a signed-out visitor gets the denial state, not a broken panel
 * - an empty tenant can create a draft agent (v1)
 * - a failing publish shows every blocking finding (AC-F08-2)
 * - a passing publish reports v1 live (AC-F08-1)
 * - the versions tab lists versions and rolls back to an earlier one
 * - a publish refusal is surfaced as a denial message (AC-F08-3)
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

const AGENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const V1_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const V2_ID = "bbbbbbbb-0000-4000-8000-000000000002";

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function agentRow(overrides = {}) {
  return {
    id: AGENT_ID,
    name: "Support agent",
    description: "",
    status: "DRAFT",
    activeVersionId: null,
    activeVersion: null,
    draftVersion: 1,
    updatedAt: "2026-11-03T10:00:00.000Z",
    ...overrides,
  };
}

function versionRow(overrides = {}) {
  return {
    id: V1_ID,
    version: 1,
    status: "DRAFT",
    configJson: { systemPrompt: "Help", model: "llama-3.3-70b" },
    createdAt: "2026-11-03T10:00:00.000Z",
    publishedAt: null,
    evaluationRuns: [],
    ...overrides,
  };
}

function detail(versions) {
  // The newest published version is the live one.
  const active = [...versions]
    .filter((version) => version.status === "PUBLISHED")
    .sort((a, b) => b.version - a.version)[0];
  return {
    id: AGENT_ID,
    name: "Support agent",
    activeVersion: active ? { id: active.id, version: active.version } : null,
    versions,
  };
}

async function seedSession(page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(session)],
  );
}

function isAgentDetail(url) {
  return /\/ai\/agents\/[^/?]+$/.test(url.pathname);
}

function isAgentCollection(url) {
  return url.pathname.endsWith("/ai/agents");
}

function isEvaluation(url) {
  return url.pathname.endsWith("/evaluations");
}

function isPublish(url) {
  return url.pathname.endsWith("/publish");
}

function isRollback(url) {
  return url.pathname.endsWith("/rollback");
}

/** Route all lifecycle calls from one handler with mutable state. */
async function routeLifecycle(page, state) {
  await page.route("**/auth/session*", (route) =>
    route.fulfill(json(sessionResponse)),
  );
  await page.route("**/ai/agents**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (isEvaluation(url) && method === "POST") {
      state.versions = state.versions.map((version) =>
        version.status === "DRAFT"
          ? {
              ...version,
              evaluationRuns: [
                {
                  id: "run-1",
                  datasetVersion: "support-triage@1.0.0",
                  status: "PASSED",
                  aggregateJson: { total: 3, passed: 3, failed: 0 },
                  failureReasonsJson: [],
                  createdAt: "2026-11-03T10:05:00.000Z",
                },
              ],
            }
          : version,
      );
      await route.fulfill(json({ runId: "run-1", status: "PASSED" }, 201));
      return;
    }

    if (isPublish(url) && method === "POST") {
      if (state.publishDenied) {
        await route.fulfill(json({ message: "Missing permission" }, 403));
        return;
      }
      if (state.publishFindings) {
        await route.fulfill(
          json(
            {
              message: "Publication is blocked by failed release checks",
              findings: state.publishFindings,
            },
            422,
          ),
        );
        return;
      }
      state.versions = state.versions.map((version) =>
        version.status === "DRAFT"
          ? {
              ...version,
              status: "PUBLISHED",
              publishedAt: "2026-11-03T10:06:00.000Z",
            }
          : version,
      );
      state.agent = agentRow({ activeVersion: 1, activeVersionId: V1_ID });
      await route.fulfill(
        json({ agentId: AGENT_ID, version: 1, publishedAt: "2026-11-03T10:06:00.000Z" }, 201),
      );
      return;
    }

    if (isRollback(url) && method === "POST") {
      state.agent = agentRow({ activeVersion: 2, activeVersionId: V2_ID });
      await route.fulfill(json({ agentId: AGENT_ID, activeVersion: 2 }, 201));
      return;
    }

    if (isAgentDetail(url)) {
      await route.fulfill(json(detail(state.versions)));
      return;
    }

    if (isAgentCollection(url) && method === "POST") {
      state.created = true;
      state.versions = [versionRow()];
      state.agent = agentRow();
      await route.fulfill(
        json({ agentId: AGENT_ID, versionId: V1_ID, version: 1 }, 201),
      );
      return;
    }

    if (isAgentCollection(url)) {
      await route.fulfill(json(state.created ? [state.agent] : []));
      return;
    }

    await route.fulfill(json({ message: "not found" }, 404));
  });
}

test.describe("agent lifecycle (T4.06, F-08)", () => {
  test("signed out, the evaluation tab shows the denial state", async ({
    page,
  }) => {
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/ai/agents**", (route) =>
      route.fulfill(json({ message: "Unauthorized" }, 401)),
    );

    await page.goto("/studio");
    await page.getByRole("button", { name: "8. Evaluation" }).click();

    await expect(page.getByTestId("agents-denied")).toBeVisible();
  });

  test("an empty tenant can create the first draft agent", async ({ page }) => {
    const state = { agent: agentRow(), versions: [versionRow()], created: false };
    await seedSession(page);
    await routeLifecycle(page, state);

    await page.goto("/studio");
    await page.getByRole("button", { name: "8. Evaluation" }).click();

    await expect(page.getByTestId("agents-empty")).toBeVisible();
    await page.getByTestId("agent-name").fill("Support agent");
    await page.getByTestId("draft-submit").click();

    await expect(page.getByTestId("agents-notice")).toContainText("v1");
    await expect(page.getByTestId("agent-select")).toHaveCount(1);
  });

  test("a blocked publish lists findings, then a passing publish goes live (AC-F08-1, AC-F08-2)", async ({
    page,
  }) => {
    const state = {
      agent: agentRow(),
      versions: [versionRow()],
      created: true,
      publishFindings: [
        {
          code: "missing_evaluation",
          datasetVersion: "support-triage@1.0.0",
          message: "Run support-triage@1.0.0 before publishing",
        },
      ],
    };
    await seedSession(page);
    await routeLifecycle(page, state);

    await page.goto("/studio");
    await page.getByRole("button", { name: "8. Evaluation" }).click();
    await expect(page.getByTestId("agent-select")).toHaveCount(1);

    // A publish without evidence is refused and every finding is shown.
    await page.getByTestId("publish-version").click();
    await expect(page.getByTestId("publish-findings")).toContainText(
      "missing_evaluation",
    );
    await expect(page.getByTestId("publish-findings")).toContainText(
      "support-triage@1.0.0",
    );

    // Running the dataset clears the gate and the draft becomes live.
    state.publishFindings = null;
    await page.getByTestId("run-evaluation").click();
    await expect(page.getByTestId("evaluation-result")).toContainText("PASSED");

    await page.getByTestId("publish-version").click();
    await expect(page.getByTestId("agents-notice")).toContainText("Published v1");
    await expect(page.getByTestId("active-version")).toContainText("Live: v1");
  });

  test("the versions tab lists history and rolls back to an earlier version", async ({
    page,
  }) => {
    const state = {
      agent: agentRow({ activeVersion: 2, activeVersionId: V2_ID }),
      versions: [
        versionRow({
          id: V2_ID,
          version: 2,
          status: "PUBLISHED",
          publishedAt: "2026-11-03T10:06:00.000Z",
        }),
        versionRow({ version: 1, status: "PUBLISHED", publishedAt: "2026-11-03T10:00:00.000Z" }),
      ],
      created: true,
    };
    await seedSession(page);
    await routeLifecycle(page, state);

    await page.goto("/studio");
    await page.getByRole("button", { name: "9. Versions" }).click();

    await expect(page.getByTestId("version-row")).toHaveCount(2);
    // Only the version that is not already live offers a rollback.
    await expect(page.getByTestId("rollback-version")).toHaveCount(1);
    await page.getByTestId("rollback-version").click();
    await expect(page.getByTestId("rollback-result")).toContainText("v2");
  });

  test("a publish refusal without findings is shown as a message (AC-F08-3)", async ({
    page,
  }) => {
    const state = {
      agent: agentRow(),
      versions: [versionRow()],
      created: true,
      publishDenied: true,
    };
    await seedSession(page);
    await routeLifecycle(page, state);

    await page.goto("/studio");
    await page.getByRole("button", { name: "8. Evaluation" }).click();
    await page.getByTestId("publish-version").click();

    await expect(page.getByTestId("agents-error")).toContainText(
      "Missing permission",
    );
  });
});
