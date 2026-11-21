/**
 * Live D-58 verifier (synthetic account only).
 *
 * Creates one `smokecheck-mfa-*@velaris.test` tenant administrator, enrolls
 * TOTP, checks the `aal2` claim, then proves a role write is denied without a
 * step-up grant and accepted with one. A targeted cleanup runs whether the
 * checks pass or fail. Only status evidence is printed or written; no
 * password, token, TOTP secret or QR payload is recorded.
 *
 * Usage: node --env-file=.env .agents/verify-d58-live-totp.mjs
 */

import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const api = process.env.D58_API_ORIGIN || "http://127.0.0.1:3000";
const supabase = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabase || !anon) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const email = `smokecheck-mfa-${stamp}@velaris.test`;
const password = `Mfa!${randomBytes(18).toString("hex")}9z`;
const evidence = {
  generatedAt: new Date().toISOString(),
  apiOrigin: api,
  supabaseHost: new URL(supabase).host,
  syntheticEmail: email,
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

async function request(label, url, init) {
  const response = await fetch(url, init);
  const body = await readJson(response);
  evidence[`${label}Status`] = response.status;
  if (!response.ok) {
    throw new Error(
      `${label} HTTP ${response.status}${body?.code ? ` ${body.code}` : ""}`,
    );
  }
  return body;
}

function apiHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function authHeaders(token) {
  return { apikey: anon, ...apiHeaders(token) };
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
  if (seconds > 26) {
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

async function run() {
  const signup = await request("signup", `${api}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      tenantName: `Smoke check MFA ${stamp}`,
    }),
  });
  if (typeof signup?.tenantId !== "string") {
    throw new Error("signup returned no tenantId");
  }
  const tenantId = signup.tenantId;
  evidence.tenantId = tenantId;

  const login = await request(
    "passwordGrant",
    `${supabase}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const aal1 = login?.access_token;
  if (typeof aal1 !== "string")
    throw new Error("password grant returned no token");

  const enrolled = await request(
    "factorEnroll",
    `${supabase}/auth/v1/factors`,
    {
      method: "POST",
      headers: authHeaders(aal1),
      body: JSON.stringify({
        factor_type: "totp",
        friendly_name: "D-58 live synthetic",
      }),
    },
  );
  const factorId = enrolled?.id;
  const secret = enrolled?.totp?.secret;
  if (typeof factorId !== "string" || typeof secret !== "string") {
    throw new Error("TOTP enrollment returned no factor or secret");
  }

  const challenge = await request(
    "challenge",
    `${supabase}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`,
    { method: "POST", headers: authHeaders(aal1), body: "{}" },
  );
  if (typeof challenge?.id !== "string") {
    throw new Error("TOTP challenge returned no id");
  }

  await waitForFreshWindow();
  const verified = await request(
    "verify",
    `${supabase}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
    {
      method: "POST",
      headers: authHeaders(aal1),
      body: JSON.stringify({ challenge_id: challenge.id, code: totp(secret) }),
    },
  );
  const aal2 = verified?.access_token;
  if (typeof aal2 !== "string" || typeof verified?.refresh_token !== "string") {
    throw new Error("TOTP verification returned no token pair");
  }
  const payload = JSON.parse(Buffer.from(aal2.split(".")[1], "base64url"));
  evidence.aal = payload.aal ?? null;
  evidence.sessionIdPresent = typeof payload.session_id === "string";
  evidence.refreshTokenReplaced =
    verified.refresh_token !== login.refresh_token;
  if (payload.aal !== "aal2")
    throw new Error(`access token aal is ${payload.aal}`);

  const session = await request("session", `${api}/auth/session`, {
    headers: apiHeaders(aal2),
  });
  evidence.sessionRole = session?.role ?? null;

  const roleCode = `R-live-mfa-${stamp}`;
  const roleBody = {
    code: roleCode,
    name: `Live MFA ${stamp}`,
    baseRoleCode: "R-agent",
  };
  const deniedResponse = await fetch(`${api}/tenants/${tenantId}/roles`, {
    method: "POST",
    headers: apiHeaders(aal2),
    body: JSON.stringify(roleBody),
  });
  const denied = await readJson(deniedResponse);
  evidence.writeWithoutGrantStatus = deniedResponse.status;
  evidence.writeWithoutGrantCode = denied?.code ?? null;
  if (
    deniedResponse.status !== 403 ||
    evidence.writeWithoutGrantCode !== "STEP_UP_REQUIRED"
  ) {
    throw new Error(
      `ungranted write HTTP ${deniedResponse.status} ${evidence.writeWithoutGrantCode ?? ""}`.trim(),
    );
  }

  const stepUp = await request("stepUp", `${api}/auth/step-up`, {
    method: "POST",
    headers: apiHeaders(aal2),
    body: JSON.stringify({ action: "role.change", tenantId, password }),
  });
  if (typeof stepUp?.token !== "string") {
    throw new Error("step-up returned no grant");
  }
  evidence.grantIssued = true;

  const written = await request(
    "writeWithGrant",
    `${api}/tenants/${tenantId}/roles`,
    {
      method: "POST",
      headers: { ...apiHeaders(aal2), "x-step-up-token": stepUp.token },
      body: JSON.stringify(roleBody),
    },
  );
  evidence.roleId = written?.id ?? null;
  evidence.roleCode = written?.code ?? null;
  evidence.rolePermissionCount = written?.permissionCount ?? null;

  const replayResponse = await fetch(`${api}/tenants/${tenantId}/roles`, {
    method: "POST",
    headers: { ...apiHeaders(aal2), "x-step-up-token": stepUp.token },
    body: JSON.stringify({ ...roleBody, code: `${roleCode}-replay` }),
  });
  const replay = await readJson(replayResponse);
  evidence.replayStatus = replayResponse.status;
  evidence.replayCode = replay?.code ?? null;
}

let failure = null;
try {
  await run();
} catch (error) {
  failure = error;
  evidence.failure = error instanceof Error ? error.message : String(error);
}

const cleanup = cleanupSyntheticAccount();
evidence.cleanup = cleanup.ok ? "removed" : "failed";
if (!cleanup.ok) evidence.cleanupFailure = cleanup.detail;
evidence.result = failure || !cleanup.ok ? "failed" : "pass";

await writeFile(
  ".agents/evidence-d58-live-totp.json",
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
