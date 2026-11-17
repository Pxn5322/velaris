/**
 * Live browser verifier for the D-58 step-up dialog.
 *
 * Creates one `smokecheck-mfa-*@velaris.test` tenant administrator, opens the
 * web Roles panel, triggers the step-up dialog, enrolls a first TOTP factor,
 * and completes the denied-then-granted role write. A targeted cleanup runs
 * whatever the outcome. Only status evidence is recorded; no password, token,
 * TOTP secret or QR payload is written or printed.
 *
 * Prerequisites: local API on :3000 and web build on :3001, both connected to
 * the development Supabase project.
 *
 * Usage: node --env-file=.env .agents/verify-d58-web-step-up.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const api = process.env.D58_API_ORIGIN || "http://localhost:3000";
const web = process.env.D58_WEB_ORIGIN || "http://localhost:3001";
const supabase = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabase || !anon) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const SESSION_KEY = "velaris.auth.session.v1";
const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const email = `smokecheck-mfa-web-${stamp}@velaris.test`;
const password = `Mfa!${randomBytes(18).toString("hex")}9z`;
const roleCode = `R-web-mfa-${stamp}`;
const evidence = {
  generatedAt: new Date().toISOString(),
  apiOrigin: api,
  webOrigin: web,
  supabaseHost: new URL(supabase).host,
  syntheticEmail: email,
  roleCode,
  network: [],
};

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRoleWrite(response) {
  return (
    response.request().method() === "POST" &&
    /^\/tenants\/[^/]+\/roles$/.test(new URL(response.url()).pathname)
  );
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("TOTP secret is not base32");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(message)
    .digest();
  const offset = digest[19] & 0x0f;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}

async function waitForFreshWindow() {
  const seconds = Math.floor(Date.now() / 1000) % 30;
  if (seconds > 25) {
    await new Promise((resolve) =>
      setTimeout(resolve, (30 - seconds + 1) * 1000),
    );
  }
}

function runCleanup(args) {
  const result = spawnSync(
    process.execPath,
    ["scripts/cleanup-load-tenants.mjs", ...args],
    { encoding: "utf8", env: process.env, timeout: 120_000 },
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function cleanupSyntheticAccount() {
  // Run even after an ambiguous signup failure: the unique synthetic email
  // makes a targeted delete safe, and an orphan account must not remain.
  const deleted = runCleanup(["--delete", "--email", email]);
  if (!deleted.ok) {
    return {
      ok: false,
      detail: `delete failed: ${deleted.output.split("\n").slice(-3).join(" | ")}`,
    };
  }
  const check = runCleanup(["--email", email]);
  const clean =
    check.ok &&
    /Synthetic tenants: 0\b/.test(check.output) &&
    /Synthetic auth accounts: 0\b/.test(check.output);
  if (!clean) {
    return {
      ok: false,
      detail: `targeted cleanup did not report 0/0: ${check.output
        .split("\n")
        .slice(-3)
        .join(" | ")}`,
    };
  }
  return {
    ok: true,
    removed: /Deleted (?:tenant|auth account)/.test(deleted.output),
  };
}

async function main() {
  const signupResponse = await fetch(`${api}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      tenantName: `Smoke check MFA web ${stamp}`,
    }),
  });
  const signup = await readJson(signupResponse);
  evidence.signupStatus = signupResponse.status;
  if (!signupResponse.ok || typeof signup?.tenantId !== "string") {
    throw new Error(`signup HTTP ${signupResponse.status}`);
  }
  evidence.tenantId = signup.tenantId;

  const tokenResponse = await fetch(
    `${supabase}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const tokens = await readJson(tokenResponse);
  evidence.passwordGrantStatus = tokenResponse.status;
  if (!tokenResponse.ok || typeof tokens?.access_token !== "string") {
    throw new Error(`password grant HTTP ${tokenResponse.status}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      evidence.pageError = error.message;
    });
    page.on("response", async (response) => {
      const request = response.request();
      const url = new URL(response.url());
      const path = url.pathname;
      if (
        !path.endsWith("/auth/step-up") &&
        !path.endsWith("/auth/session") &&
        !/\/tenants\/[^/]+\/roles$/.test(path)
      ) {
        return;
      }
      const body = await readJson(response).catch(() => null);
      evidence.network.push({
        method: request.method(),
        path,
        status: response.status(),
        code: body?.code ?? null,
      });
    });

    await context.addInitScript(
      ({ key, session }) => window.localStorage.setItem(key, session),
      {
        key: SESSION_KEY,
        session: JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
          email,
        }),
      },
    );

    await page.goto(`${web}/admin`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Roles & RBAC" }).click();
    await page
      .locator('[data-testid="role-card"]')
      .first()
      .waitFor({ timeout: 15_000 });
    await page.getByTestId("role-create-open").click();
    await page.getByTestId("role-code").fill(roleCode);
    await page.getByTestId("role-name").fill(`Web MFA ${stamp}`);
    await page.getByTestId("role-base").selectOption("R-agent");
    const deniedResponse = page.waitForResponse(isRoleWrite);
    await page.getByTestId("role-create-submit").click();

    await page.getByTestId("step-up-dialog").waitFor({ timeout: 15_000 });
    const denied = await deniedResponse;
    evidence.deniedRoleWrite = {
      method: "POST",
      path: new URL(denied.url()).pathname,
      status: denied.status(),
      code: null,
    };
    evidence.dialogOpened = true;
    await page.getByTestId("step-up-password").fill(password);
    await page.getByTestId("step-up-password-submit").click();

    await page.getByTestId("step-up-mfa-form").waitFor({ timeout: 15_000 });
    const secret = await page
      .locator('[data-testid="step-up-mfa-form"] code')
      .innerText();
    evidence.enrollmentFormShown = true;
    await waitForFreshWindow();
    await page.getByTestId("step-up-code").fill(totp(secret));
    const grantedResponse = page.waitForResponse(
      (response) => isRoleWrite(response) && response.status() === 201,
    );
    await page.getByTestId("step-up-code-submit").click();

    await page.getByTestId("roles-notice").waitFor({ timeout: 20_000 });
    const granted = await grantedResponse;
    evidence.grantedRoleWrite = {
      method: "POST",
      path: new URL(granted.url()).pathname,
      status: granted.status(),
      code: null,
    };
    evidence.notice = await page.getByTestId("roles-notice").innerText();
    const roleCard = page.locator(
      `[data-testid="role-card"][data-role-code="${roleCode}"]`,
    );
    await roleCard.waitFor({ state: "visible", timeout: 5_000 });
    evidence.roleCardVisible = true;
    await page.waitForLoadState("networkidle");

    const stored = await page.evaluate((key) => {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, SESSION_KEY);
    const payload = stored?.accessToken
      ? JSON.parse(
          Buffer.from(stored.accessToken.split(".")[1], "base64url").toString(),
        )
      : null;
    evidence.aal = payload?.aal ?? null;
    evidence.sessionIdPresent = typeof payload?.session_id === "string";

    evidence.deniedRoleWrite.code =
      evidence.network.find(
        (item) =>
          item.method === "POST" &&
          item.status === 403 &&
          /\/roles$/.test(item.path),
      )?.code ?? null;
    evidence.grantedRoleWrite.code =
      evidence.network.find(
        (item) =>
          item.method === "POST" &&
          item.status === 201 &&
          /\/roles$/.test(item.path),
      )?.code ?? null;
    evidence.stepUpCalls = evidence.network.filter((item) =>
      item.path.endsWith("/auth/step-up"),
    );

    assert.equal(evidence.dialogOpened, true);
    assert.equal(evidence.enrollmentFormShown, true);
    assert.equal(evidence.aal, "aal2");
    assert.equal(evidence.sessionIdPresent, true);
    assert.equal(evidence.deniedRoleWrite.status, 403);
    assert.equal(evidence.grantedRoleWrite.status, 201);
    assert.equal(evidence.roleCardVisible, true);
    assert.match(evidence.notice, /was created\.$/);
    assert.ok(evidence.stepUpCalls.some((call) => call.status === 403));
    assert.ok(evidence.stepUpCalls.some((call) => call.status === 200));
  } finally {
    await browser.close();
  }
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  evidence.failure = error instanceof Error ? error.message : String(error);
}

const cleanup = cleanupSyntheticAccount();
evidence.cleanup = cleanup.ok
  ? cleanup.removed
    ? "removed"
    : "not-created"
  : "failed";
if (!cleanup.ok) evidence.cleanupFailure = cleanup.detail;
const failed = Boolean(failure) || !cleanup.ok;
evidence.result = failed ? "failed" : "pass";

await writeFile(
  ".agents/evidence-d58-web-step-up.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));

if (failed) {
  if (failure) console.error(evidence.failure);
  if (!cleanup.ok) console.error(`Cleanup failed: ${cleanup.detail}`);
  process.exitCode = 1;
}
