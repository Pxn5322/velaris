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

function cleanupSyntheticAccount() {
  const result = spawnSync(
    process.execPath,
    ["scripts/cleanup-load-tenants.mjs", "--delete", "--email", email],
    { encoding: "utf8", env: process.env },
  );
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    detail: (result.stderr || result.stdout || "cleanup failed")
      .trim()
      .split("\n")
      .slice(-3)
      .join(" | "),
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
        expiresAt:
          tokens.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
        email,
      }),
    },
  );

  try {
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
    await page.getByTestId("role-create-submit").click();

    await page.getByTestId("step-up-dialog").waitFor({ timeout: 15_000 });
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
    await page.getByTestId("step-up-code-submit").click();

    await page.getByTestId("roles-notice").waitFor({ timeout: 20_000 });
    evidence.notice = await page.getByTestId("roles-notice").innerText();
    evidence.roleCardVisible = await page
      .locator(`[data-testid="role-card"][data-role-code="${roleCode}"]`)
      .isVisible();

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

    const roleWrites = evidence.network.filter(
      (item) => item.method === "POST" && /\/roles$/.test(item.path),
    );
    evidence.deniedRoleWrite = roleWrites.find(
      (item) => item.status === 403,
    ) ?? null;
    evidence.grantedRoleWrite = roleWrites.find(
      (item) => item.status === 201,
    ) ?? null;
    evidence.stepUpCalls = evidence.network.filter((item) =>
      item.path.endsWith("/auth/step-up"),
    );
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
evidence.cleanup = cleanup.ok ? "removed" : "failed";
if (!cleanup.ok) evidence.cleanupFailure = cleanup.detail;
evidence.result = failure || !cleanup.ok ? "failed" : "pass";

await writeFile(
  ".agents/evidence-d58-web-step-up.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));

if (failure) {
  console.error(evidence.failure);
  process.exitCode = 1;
}
if (!cleanup.ok) {
  console.error(`Cleanup failed: ${cleanup.detail}`);
  process.exitCode = 1;
}
