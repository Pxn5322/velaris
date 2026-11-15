// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Platform AI Governance provider CRUD.
 *
 * The admin-v2.7 panel is backed by /ai-governance/providers. Only an
 * environment-variable reference is sent; no credential is entered or shown.
 */

const SESSION_KEY = "velaris.auth.session.v1";

const session = {
  accessToken: "e2e-access-token",
  refreshToken: "e2e-refresh-token",
  expiresAt: 0,
  email: "platform@example.test",
};

const sessionResponse = {
  identity: {
    provider: "supabase",
    subject: "sub-platform",
    email: "platform@example.test",
  },
  tenantContext: {
    userId: "user-platform",
    displayName: "Platform Admin",
    tenants: [
      {
        tenantId: "tenant-a",
        slug: "acme",
        name: "Acme",
        membershipId: "membership-platform",
      },
    ],
  },
  role: "R-enterprise-admin",
};

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test.describe("AI Governance model gateway", () => {
  test("creates, edits and deletes a provider", async ({ page }) => {
    const calls = [];
    let current = [];

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SESSION_KEY, JSON.stringify(session)],
    );
    await page.route("**/auth/session*", (route) =>
      route.fulfill(json(sessionResponse)),
    );
    await page.route("**/audit/events*", (route) =>
      route.fulfill(json({ items: [], limit: 8, hasMore: false })),
    );
    await page.route("**/ai-governance/providers**", (route) => {
      const request = route.request();
      const method = request.method();
      const body =
        method === "GET" || method === "DELETE" ? null : request.postDataJSON();
      calls.push({ method, body });
      if (method === "GET") return route.fulfill(json(current));
      if (method === "POST") {
        const created = {
          id: "33333333-3333-4333-8333-333333333333",
          ...body,
          createdAt: "2026-11-15T10:00:00.000Z",
          updatedAt: "2026-11-15T10:00:00.000Z",
        };
        current = [created];
        return route.fulfill(json(created, 201));
      }
      if (method === "PATCH") {
        const id = request.url().split("/").pop().split("?")[0];
        const updated = {
          ...current.find((row) => row.id === id),
          ...body,
          updatedAt: "2026-11-15T10:05:00.000Z",
        };
        current = current.map((row) => (row.id === id ? updated : row));
        return route.fulfill(json(updated));
      }
      const id = request.url().split("/").pop().split("?")[0];
      current = current.filter((row) => row.id !== id);
      return route.fulfill(json({ id, deleted: true }));
    });

    await page.goto("/admin");
    await page.getByRole("button", { name: "AI Governance" }).click();
    await expect(page.getByTestId("ai-governance-panel")).toBeVisible();
    await expect(page.getByTestId("ai-providers-empty")).toBeVisible();

    await page.getByTestId("ai-provider-create-open").click();
    await page.getByTestId("ai-provider-name").fill("OpenAI primary");
    await page.getByTestId("ai-provider-provider").fill("openai");
    await page.getByTestId("ai-provider-model").fill("gpt-4o");
    await page.getByTestId("ai-provider-key-ref").fill("OPENAI_API_KEY");
    await page.getByTestId("ai-provider-default").check();
    await page.getByTestId("ai-provider-submit").click();

    await expect(page.getByTestId("ai-provider-row")).toContainText(
      "OpenAI primary",
    );
    await expect(page.getByTestId("ai-provider-row")).toContainText("DEFAULT");
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      name: "OpenAI primary",
      provider: "openai",
      model: "gpt-4o",
      apiKeyRef: "OPENAI_API_KEY",
      isDefault: true,
    });

    await page.getByRole("button", { name: "Edit OpenAI primary" }).click();
    await page.getByTestId("ai-provider-model").fill("gpt-4.1");
    await page.getByTestId("ai-provider-submit").click();
    await expect(page.getByTestId("ai-provider-row")).toContainText("gpt-4.1");
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      model: "gpt-4.1",
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete OpenAI primary" }).click();
    await expect(page.getByTestId("ai-provider-row")).toHaveCount(0);
    await expect(page.getByTestId("ai-providers-empty")).toBeVisible();
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });
});