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
  // The platform directory answers one page plus the total (D-87).
  const directoryRows = Array.isArray(directoryBody)
    ? directoryBody
    : (directoryBody?.items ?? []);
  checks.directoryTotal = directoryBody?.total ?? directoryRows.length;
  checks.directoryRows = directoryRows.length;
  checks.directoryTenants = new Set(
    directoryRows.map((row) => row.tenantName).filter(Boolean),
  ).size;
  const directoryNamed =
    directoryRows.length > 0 &&
    directoryRows.every((row) => typeof row.tenantName === "string");
  if (directory.status !== 200 || !directoryNamed) {
    throw new Error(`platform directory failed with HTTP ${directory.status}`);
  }
  const avatarFieldPresent = directoryRows.every((row) =>
    Object.prototype.hasOwnProperty.call(row, "avatarDataUrl"),
  );
  const photoRows = directoryRows.filter(
    (row) =>
      typeof row.avatarDataUrl === "string" &&
      row.avatarDataUrl.startsWith("data:image/"),
  );
  checks.directoryAvatarField = avatarFieldPresent;
  checks.directoryAvatars = photoRows.length;
  if (!avatarFieldPresent || photoRows.length === 0 || !photoRows[0].email) {
    throw new Error("platform directory did not return a usable profile photo");
  }
  const photoEmail = photoRows[0].email;

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
  const groqProvider = providerBody.find((row) => row.provider === "groq");
  const defaultProviders = providerBody.filter((row) => row.isDefault);
  checks.groqProvider = Boolean(groqProvider);
  checks.groqModel = groqProvider?.model ?? null;
  checks.defaultProviders = defaultProviders.length;
  if (
    !groqProvider ||
    groqProvider.status !== "ACTIVE" ||
    groqProvider.isDefault !== true ||
    !groqProvider.model ||
    defaultProviders.length !== 1
  ) {
    throw new Error("Groq is not the single active default provider");
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

  const audit = await api(
    apiUrl,
    `/audit/events?tenantId=${encodeURIComponent(tenant.tenantId)}&limit=25`,
    tenantSession.accessToken,
  );
  const auditBody = await readJson(audit);
  const auditEvents = Array.isArray(auditBody?.items) ? auditBody.items : [];
  const auditActors = auditEvents.filter(
    (row) => row.actorName || row.actorEmail,
  ).length;
  const auditRoles = auditEvents.filter(
    (row) => Array.isArray(row.actorRoles) && row.actorRoles.length > 0,
  ).length;
  const auditLabels = auditEvents.filter((row) => row.resourceLabel).length;
  checks.audit = audit.status;
  checks.auditEvents = auditEvents.length;
  checks.auditActorLabels = auditActors;
  checks.auditRoleLabels = auditRoles;
  checks.auditResourceLabels = auditLabels;
  if (
    audit.status !== 200 ||
    auditEvents.length === 0 ||
    auditActors === 0 ||
    auditRoles === 0 ||
    auditLabels === 0
  ) {
    throw new Error("audit labels are incomplete");
  }

  const dashboard = await api(
    apiUrl,
    `/analytics/tenant-dashboard?tenantId=${encodeURIComponent(tenant.tenantId)}`,
    tenantSession.accessToken,
  );
  const dashboardBody = await readJson(dashboard);
  checks.dashboard = dashboard.status;
  checks.dashboardTokens = dashboardBody?.totalMonthlyTokens;
  checks.dashboardActiveAgents = dashboardBody?.activeAgents;
  checks.dashboardTickets = dashboardBody?.tickets?.total;
  const statusCounts = ["pendingCustomer", "inProgress", "resolved", "closed"];
  const dashboardValid =
    dashboard.status === 200 &&
    typeof dashboardBody?.totalMonthlyTokens === "number" &&
    typeof dashboardBody?.activeAgents === "number" &&
    typeof dashboardBody?.tickets?.total === "number" &&
    statusCounts.every(
      (key) => typeof dashboardBody?.tickets?.[key] === "number",
    );
  if (!dashboardValid) {
    throw new Error(`tenant dashboard failed with HTTP ${dashboard.status}`);
  }

  if (!skipUi) {
    const browser = await chromium.launch({ headless: true });
    try {
      const enterprise = await checkEnterpriseUi(
        browser,
        webUrl,
        adminEmail,
        adminPassword,
        photoEmail,
        groqProvider.model,
      );
      const tenantUi = await checkTenantUi(
        browser,
        webUrl,
        tenantEmail,
        tenantPassword,
      );
      checks.ui = "pass";
      checks.uiDirectoryAvatar = enterprise.directoryAvatar;
      checks.uiGroqProvider = enterprise.groqProvider;
      checks.uiAuditLabels = enterprise.auditLabels;
      checks.uiAuditTrailLabels = enterprise.auditTrailLabels;
      checks.uiSignOut = enterprise.signOut;
      checks.uiAttachment = tenantUi.attachment;
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

async function checkEnterpriseUi(
  browser,
  webUrl,
  email,
  password,
  photoEmail,
  groqModel,
) {
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
    await page.getByTestId("tenant-users-search").fill(photoEmail);
    await page.getByTestId("tenant-user-avatar-image").first().waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByTestId("tenant-users-search").fill("");
    await page.getByTestId("tenant-user-avatar-initials").first().waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "AI Governance" }).click();
    await page.getByTestId("ai-governance-panel").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("ai-provider-create-open").waitFor({
      state: "visible",
    });
    await page
      .getByText(`groq / ${groqModel}`, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });

    await page.getByRole("button", { name: "Platform Analytics" }).click();
    await page.getByTestId("admin-audit-stream").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("admin-audit-event").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    if ((await page.getByTestId("admin-audit-event-roles").count()) === 0) {
      throw new Error("audit stream did not render role labels");
    }
    const firstAuditText = await page
      .getByTestId("admin-audit-event")
      .first()
      .innerText();
    if (/actor [0-9a-f]{8}-[0-9a-f-]{27,}/i.test(firstAuditText)) {
      throw new Error("audit stream rendered a raw actor id");
    }

    await page.goto(`${webUrl}/audit`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("audit-events-list").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    if ((await page.getByTestId("audit-event-roles").count()) === 0) {
      throw new Error("audit trail did not render role labels");
    }
    const firstTrailText = await page
      .getByTestId("audit-event")
      .first()
      .innerText();
    if (/actor [0-9a-f]{8}-[0-9a-f-]{27,}/i.test(firstTrailText)) {
      throw new Error("audit trail rendered a raw actor id");
    }

    await page.getByTestId("nav-sign-out").click();
    await page.waitForURL(
      (url) => url.origin === new URL(webUrl).origin && url.pathname === "/",
      { timeout: 30_000 },
    );
    await page
      .getByRole("heading", {
        level: 1,
        name: /Intelligent Customer Operations/i,
      })
      .waitFor({ state: "visible", timeout: 30_000 });
    if (
      await page
        .getByTestId("sign-in-email")
        .isVisible()
        .catch(() => false)
    ) {
      throw new Error("sign-out opened the sign-in modal");
    }
    return {
      directoryAvatar: "pass",
      groqProvider: "pass",
      auditLabels: "pass",
      auditTrailLabels: "pass",
      signOut: "pass",
    };
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
    await page.getByTestId("tenant-dashboard-tokens").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("tenant-dashboard-agents").waitFor({
      state: "visible",
    });
    await page.getByTestId("tenant-dashboard-tickets").waitFor({
      state: "visible",
    });
    if (
      (await page.getByTestId("tenant-dashboard").getByRole("link").count()) !==
      0
    ) {
      throw new Error("tenant dashboard still renders the link cards");
    }
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

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("inbox-ticket").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("inbox-ticket").first().click();
    await page.getByTestId("inbox-attach").waitFor({ state: "visible" });
    await page.getByTestId("inbox-timeline").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const existingAttachment = page
      .getByTestId("inbox-timeline")
      .getByText("hosted-smoke.txt");
    if ((await existingAttachment.count()) > 0) {
      return { attachment: "pass-existing" };
    }
    await page.getByTestId("inbox-attach-input").setInputFiles({
      name: "hosted-smoke.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hosted inbox attachment smoke."),
    });
    await page
      .getByTestId("inbox-attachment-list")
      .getByText("hosted-smoke.txt")
      .waitFor({ state: "visible", timeout: 10_000 });
    const marker = "Hosted smoke attachment";
    await page.getByTestId("inbox-reply").fill(marker);
    await page.getByTestId("inbox-send").click();
    await page
      .getByTestId("inbox-timeline")
      .getByText(marker)
      .waitFor({ state: "visible", timeout: 30_000 });
    await page
      .getByTestId("inbox-timeline")
      .getByText("hosted-smoke.txt")
      .waitFor({ state: "visible", timeout: 10_000 });
    return { attachment: "pass" };
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
