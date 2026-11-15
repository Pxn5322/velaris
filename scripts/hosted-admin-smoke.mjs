#!/usr/bin/env node
/**
 * Hosted administrator smoke check.
 *
 * Verifies the deployed enterprise and tenant administrator journeys:
 * - password sign-in through the deployed web form,
 * - platform-wide User Directory,
 * - tenant Dashboards,
 * - AI Governance provider list, create, update and delete.
 *
 * A unique synthetic provider is created and removed. Cleanup runs even when
 * a later check fails and verifies that the row is absent before it reports
 * success. The script never prints a password, access token or secret value.
 *
 * Usage:
 *   node --env-file=.env.livecheck scripts/hosted-admin-smoke.mjs
 *   node --env-file=.env.livecheck scripts/hosted-admin-smoke.mjs --skip-ui
 *
 * Environment:
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
 *   SMOKE_ADMIN_PASSWORD or ADMIN_USER_PASSWORD
 *   SMOKE_TENANT_ADMIN_EMAIL or TENANT_ADMIN_EMAIL
 *   SMOKE_TENANT_ADMIN_PASSWORD or TENANT_ADMIN_PASSWORD
 *   SMOKE_ADMIN_EMAIL (optional; defaults to admin1@velaris.test)
 *
 * Origins:
 *   --url <api-origin> or SMOKE_ADMIN_API_URL
 *   --web-url <web-origin> or SMOKE_ADMIN_WEB_URL
 */

import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";

const DEFAULT_API_URL = "https://velaris-api-aral.onrender.com";
const DEFAULT_WEB_URL = "https://velaris-web-bice.vercel.app";
const ADMIN_EMAIL = "admin1@velaris.test";
const PROVIDER_PREFIX = "Hosted smoke check";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function origin(name, fallback) {
  return (
    argument(name) ??
    process.env[argumentToEnvironment(name)] ??
    fallback
  ).replace(/\/+$/, "");
}

function argumentToEnvironment(name) {
  return name === "--url" ? "SMOKE_ADMIN_API_URL" : "SMOKE_ADMIN_WEB_URL";
}

function requireEnvironment(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  throw new Error(`Set one of ${names.join(", ")}`);
}

function readJson(response) {
  return response
    .text()
    .then((text) => {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })
    .catch(() => null);
}

function authHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: node --env-file=.env.livecheck scripts/hosted-admin-smoke.mjs [--url <api>] [--web-url <web>] [--skip-ui]",
    );
    return;
  }

  const apiUrl = origin("--url", DEFAULT_API_URL);
  const webUrl = origin("--web-url", DEFAULT_WEB_URL);
  const skipUi = process.argv.includes("--skip-ui");
  const supabaseUrl = requireEnvironment(["SUPABASE_URL"]).replace(/\/+$/, "");
  const publishableKey = requireEnvironment(["SUPABASE_PUBLISHABLE_KEY"]);
  const adminEmail =
    process.env.SMOKE_ADMIN_EMAIL ??
    process.env.ADMIN_USER_EMAIL ??
    ADMIN_EMAIL;
  const adminPassword = requireEnvironment([
    "SMOKE_ADMIN_PASSWORD",
    "ADMIN_USER_PASSWORD",
  ]);
  const tenantEmail = requireEnvironment([
    "SMOKE_TENANT_ADMIN_EMAIL",
    "TENANT_ADMIN_EMAIL",
  ]);
  const tenantPassword = requireEnvironment([
    "SMOKE_TENANT_ADMIN_PASSWORD",
    "TENANT_ADMIN_PASSWORD",
  ]);

  const checks = {};
  const adminSession = await signIn(
    supabaseUrl,
    publishableKey,
    adminEmail,
    adminPassword,
  );
  checks.adminSignIn = adminSession.status;

  const adminProfile = await api(
    apiUrl,
    "/auth/session",
    adminSession.accessToken,
  );
  const adminBody = await readJson(adminProfile);
  checks.adminSession = adminProfile.status;
  checks.adminRole = adminBody?.role;
  if (adminProfile.status !== 200 || adminBody?.role !== "R-enterprise-admin") {
    throw new Error(
      `enterprise session check failed with HTTP ${adminProfile.status}`,
    );
  }

  const directory = await api(
    apiUrl,
    "/tenants/users",
    adminSession.accessToken,
  );
  const directoryBody = await readJson(directory);
  checks.directory = directory.status;
  checks.directoryRows = Array.isArray(directoryBody)
    ? directoryBody.length
    : 0;
  checks.directoryTenants = new Set(
    (Array.isArray(directoryBody) ? directoryBody : [])
      .map((row) => row.tenantName)
      .filter(Boolean),
  ).size;
  const directoryNamed =
    Array.isArray(directoryBody) &&
    directoryBody.length > 0 &&
    directoryBody.every((row) => typeof row.tenantName === "string");
  if (directory.status !== 200 || !directoryNamed) {
    throw new Error(`platform directory failed with HTTP ${directory.status}`);
  }

  const providerList = await api(
    apiUrl,
    "/ai-governance/providers",
    adminSession.accessToken,
  );
  const providerBody = await readJson(providerList);
  checks.providers = providerList.status;
  checks.providerRows = Array.isArray(providerBody) ? providerBody.length : 0;
  if (providerList.status !== 200 || !Array.isArray(providerBody)) {
    throw new Error(`provider list failed with HTTP ${providerList.status}`);
  }

  const providerName = `${PROVIDER_PREFIX} ${Date.now()}-${randomBytes(3).toString("hex")}`;
  let providerId = null;
  let providerError = null;
  let cleanupError = null;
  try {
    const create = await api(
      apiUrl,
      "/ai-governance/providers",
      adminSession.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          name: providerName,
          provider: "smokecheck",
          model: "smoke-model",
          apiKeyRef: "SMOKECHECK_API_KEY",
          status: "PAUSED",
          isDefault: false,
        }),
      },
    );
    const created = await readJson(create);
    checks.providerCreate = create.status;
    if (create.status !== 201 || !created?.id) {
      throw new Error(`provider create failed with HTTP ${create.status}`);
    }
    providerId = created.id;

    const update = await api(
      apiUrl,
      `/ai-governance/providers/${providerId}`,
      adminSession.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({ model: "smoke-model-v2", status: "ACTIVE" }),
      },
    );
    const updated = await readJson(update);
    checks.providerUpdate = update.status;
    if (
      update.status !== 200 ||
      updated?.model !== "smoke-model-v2" ||
      updated?.status !== "ACTIVE"
    ) {
      throw new Error(`provider update failed with HTTP ${update.status}`);
    }
  } catch (error) {
    providerError = error;
  } finally {
    try {
      const cleanup = await removeProvider(
        apiUrl,
        adminSession.accessToken,
        providerName,
        providerId,
      );
      checks.providerDelete = cleanup.status;
      checks.providerCleanup = `${cleanup.removed} removed, 0 remaining`;
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError) {
    throw new Error(
      `provider cleanup failed for ${providerName}: ${
        cleanupError instanceof Error ? cleanupError.message : cleanupError
      }`,
    );
  }
  if (providerError) {
    throw providerError;
  }

  const tenantSession = await signIn(
    supabaseUrl,
    publishableKey,
    tenantEmail,
    tenantPassword,
  );
  checks.tenantSignIn = tenantSession.status;
  const tenantProfile = await api(
    apiUrl,
    "/auth/session",
    tenantSession.accessToken,
  );
  const tenantBody = await readJson(tenantProfile);
  const tenant = tenantBody?.tenantContext?.tenants?.[0];
  checks.tenantSession = tenantProfile.status;
  checks.tenantRole = tenantBody?.role;
  if (
    tenantProfile.status !== 200 ||
    tenantBody?.role !== "R-tenant-admin" ||
    !tenant?.tenantId
  ) {
    throw new Error(
      `tenant session check failed with HTTP ${tenantProfile.status}`,
    );
  }

  const analytics = await api(
    apiUrl,
    `/analytics/summary?tenantId=${encodeURIComponent(tenant.tenantId)}`,
    tenantSession.accessToken,
  );
  const analyticsBody = await readJson(analytics);
  checks.dashboard = analytics.status;
  checks.dashboardState = analyticsBody?.state;
  checks.dashboardMetrics = Array.isArray(analyticsBody?.metrics)
    ? analyticsBody.metrics.length
    : 0;
  if (
    analytics.status !== 200 ||
    !Array.isArray(analyticsBody?.metrics) ||
    analyticsBody.metrics.length === 0
  ) {
    throw new Error(`tenant dashboard failed with HTTP ${analytics.status}`);
  }

  if (!skipUi) {
    const browser = await chromium.launch({ headless: true });
    try {
      await checkEnterpriseUi(browser, webUrl, adminEmail, adminPassword);
      await checkTenantUi(browser, webUrl, tenantEmail, tenantPassword);
      checks.ui = "pass";
    } finally {
      await browser.close().catch(() => undefined);
    }
  } else {
    checks.ui = "skipped";
  }

  console.log(JSON.stringify({ ok: true, apiUrl, webUrl, checks }, null, 2));
}

async function signIn(supabaseUrl, publishableKey, email, password) {
  const response = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await readJson(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(`password grant failed with HTTP ${response.status}`);
  }
  return { status: response.status, accessToken: body.access_token };
}

async function api(apiUrl, path, accessToken, init = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(accessToken), ...(init.headers ?? {}) },
  });
}

async function removeProvider(apiUrl, accessToken, name, id) {
  let removed = 0;
  let lastStatus = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const list = await api(apiUrl, "/ai-governance/providers", accessToken);
    const rows = await readJson(list);
    if (list.status !== 200 || !Array.isArray(rows)) {
      throw new Error(`provider cleanup list failed with HTTP ${list.status}`);
    }
    const matches = rows.filter((row) => row.id === id || row.name === name);
    if (matches.length === 0) {
      return { status: lastStatus ?? 200, removed };
    }
    for (const row of matches) {
      const deletion = await api(
        apiUrl,
        `/ai-governance/providers/${row.id}`,
        accessToken,
        { method: "DELETE" },
      );
      lastStatus = deletion.status;
      if (deletion.status !== 200 && deletion.status !== 404) {
        throw new Error(
          `provider cleanup delete failed with HTTP ${deletion.status}`,
        );
      }
      removed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error(`provider ${name} still exists after three cleanup attempts`);
}

async function loginThroughUi(page, webUrl, email, password) {
  await page.goto(`${webUrl}/?signin=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("sign-in-email").waitFor({ state: "visible" });
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill(password);
  await page.getByTestId("sign-in-submit").click();
  await page.waitForURL(/\/admin$/, { timeout: 60_000 });
}

async function checkEnterpriseUi(browser, webUrl, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginThroughUi(page, webUrl, email, password);
    await page.getByTestId("nav-identity").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "User Directory" }).click();
    await page.getByTestId("tenant-user-row").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    if ((await page.getByTestId("tenant-user-row").count()) === 0) {
      throw new Error("directory rendered no rows");
    }
    if ((await page.getByText("Add System User").count()) !== 0) {
      throw new Error("Add System User is still rendered");
    }
    if (
      (await page.getByRole("columnheader", { name: "Tenant" }).count()) === 0
    ) {
      throw new Error("directory did not render the Tenant column");
    }
    if ((await page.getByRole("button", { name: "Edit role" }).count()) === 0) {
      throw new Error("directory did not render icon-only role actions");
    }

    await page.getByRole("button", { name: "AI Governance" }).click();
    await page.getByTestId("ai-governance-panel").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("ai-provider-create-open").waitFor({
      state: "visible",
    });
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function checkTenantUi(browser, webUrl, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginThroughUi(page, webUrl, email, password);
    await page.getByTestId("tenant-dashboard").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    if (
      (await page.getByRole("button", { name: "Dashboards" }).count()) === 0
    ) {
      throw new Error("Dashboards tab is missing for the tenant admin");
    }
    if (
      (await page.getByRole("button", { name: "AI Governance" }).count()) !== 0
    ) {
      throw new Error("tenant admin can see the platform AI Governance tab");
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
