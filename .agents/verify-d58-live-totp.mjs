/**
 * Temporary live verifier for D-58 (not committed).
 *
 * Creates one `smokecheck-mfa-*@velaris.test` synthetic tenant administrator,
 * enrolls a TOTP factor, confirms the replacement access token carries `aal2`,
 * then proves one role write is denied without a step-up grant and accepted
 * with one. It prints and writes status evidence only. It never prints a
 * password, token, TOTP secret or QR payload.
 *
 * Usage: node --env-file=.env .agents/verify-d58-live-totp.mjs
 * Cleanup: node --env-file=.env scripts/cleanup-load-tenants.mjs --delete
 */

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
  syntheticNamespace: "smokecheck-*@velaris.test",
};

async function json(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function codeOf(body) {
  return body && typeof body.code === "string" ? body.code : null;
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
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(message)
    .digest();
  const offset = digest[19] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}

async function waitForFreshWindow() {
  const seconds = Math.floor(Date.now() / 1000) % 30;
  if (seconds > 26) {
    await new Promise((resolve) =>
      setTimeout(resolve, (30 - seconds + 1) * 1000),
    );
  }
}

const signupResponse = await fetch(`${api}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email,
    password,
    tenantName: `Smoke check MFA ${stamp}`,
  }),
});
const signup = await json(signupResponse);
evidence.signupStatus = signupResponse.status;
if (!signupResponse.ok || typeof signup?.tenantId !== "string") {
  throw new Error(
    `signup HTTP ${signupResponse.status} ${codeOf(signup) ?? ""}`.trim(),
  );
}
const tenantId = signup.tenantId;
evidence.tenantId = tenantId;

const grantResponse = await fetch(
  `${supabase}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  },
);
const passwordGrant = await json(grantResponse);
evidence.passwordGrantStatus = grantResponse.status;
if (!grantResponse.ok || typeof passwordGrant?.access_token !== "string") {
  throw new Error(`password grant HTTP ${grantResponse.status}`);
}
const aal1Token = passwordGrant.access_token;

const enrollResponse = await fetch(`${supabase}/auth/v1/factors`, {
  method: "POST",
  headers: {
    apikey: anon,
    authorization: `Bearer ${aal1Token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    factor_type: "totp",
    friendly_name: "D-58 live synthetic",
  }),
});
const enrolled = await json(enrollResponse);
evidence.factorEnrollStatus = enrollResponse.status;
const factorId = typeof enrolled?.id === "string" ? enrolled.id : null;
const secret =
  typeof enrolled?.totp?.secret === "string" ? enrolled.totp.secret : null;
if (!enrollResponse.ok || !factorId || !secret) {
  throw new Error(
    `factor enroll HTTP ${enrollResponse.status} ${codeOf(enrolled) ?? ""}`.trim(),
  );
}
evidence.factorId = factorId;
evidence.factorType = enrolled.totp ? "totp" : null;
evidence.qrCodeReturned =
  typeof enrolled.totp?.qr_code === "string" &&
  enrolled.totp.qr_code.length > 0;

const challengeResponse = await fetch(
  `${supabase}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`,
  {
    method: "POST",
    headers: {
      apikey: anon,
      authorization: `Bearer ${aal1Token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  },
);
const challenge = await json(challengeResponse);
evidence.challengeStatus = challengeResponse.status;
if (!challengeResponse.ok || typeof challenge?.id !== "string") {
  throw new Error(`challenge HTTP ${challengeResponse.status}`);
}

await waitForFreshWindow();
const verifyResponse = await fetch(
  `${supabase}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
  {
    method: "POST",
    headers: {
      apikey: anon,
      authorization: `Bearer ${aal1Token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      challenge_id: challenge.id,
      code: totp(secret),
    }),
  },
);
const verified = await json(verifyResponse);
evidence.verifyStatus = verifyResponse.status;
if (
  !verifyResponse.ok ||
  typeof verified?.access_token !== "string" ||
  typeof verified?.refresh_token !== "string"
) {
  throw new Error(
    `verify HTTP ${verifyResponse.status} ${codeOf(verified) ?? ""}`.trim(),
  );
}
const aal2Token = verified.access_token;
const payload = JSON.parse(
  Buffer.from(aal2Token.split(".")[1], "base64url").toString("utf8"),
);
evidence.aal = typeof payload.aal === "string" ? payload.aal : null;
evidence.sessionIdPresent =
  typeof payload.session_id === "string" && payload.session_id.length > 0;
evidence.refreshTokenReplaced =
  verified.refresh_token !== passwordGrant.refresh_token;
if (payload.aal !== "aal2") throw new Error(`access token aal is ${payload.aal}`);

const authHeaders = {
  authorization: `Bearer ${aal2Token}`,
  "content-type": "application/json",
};
const sessionResponse = await fetch(`${api}/auth/session`, {
  headers: authHeaders,
});
const sessionBody = await json(sessionResponse);
evidence.sessionStatus = sessionResponse.status;
evidence.sessionRole = sessionResponse.ok ? (sessionBody?.role ?? null) : null;
if (!sessionResponse.ok) {
  throw new Error(`session HTTP ${sessionResponse.status}`);
}

const roleCode = `R-live-mfa-${stamp}`;
const roleBody = {
  code: roleCode,
  name: `Live MFA ${stamp}`,
  baseRoleCode: "R-agent",
};

const deniedResponse = await fetch(`${api}/tenants/${tenantId}/roles`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify(roleBody),
});
const denied = await json(deniedResponse);
evidence.writeWithoutGrantStatus = deniedResponse.status;
evidence.writeWithoutGrantCode = codeOf(denied);
if (
  deniedResponse.status !== 403 ||
  evidence.writeWithoutGrantCode !== "STEP_UP_REQUIRED"
) {
  throw new Error(
    `ungranted write HTTP ${deniedResponse.status} ${evidence.writeWithoutGrantCode ?? ""}`.trim(),
  );
}

const stepUpResponse = await fetch(`${api}/auth/step-up`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ action: "role.change", tenantId, password }),
});
const stepUp = await json(stepUpResponse);
evidence.stepUpStatus = stepUpResponse.status;
const grantToken = typeof stepUp?.token === "string" ? stepUp.token : null;
evidence.grantIssued = Boolean(grantToken);
if (!stepUpResponse.ok || !grantToken) {
  throw new Error(
    `step-up HTTP ${stepUpResponse.status} ${codeOf(stepUp) ?? ""}`.trim(),
  );
}

const writeResponse = await fetch(`${api}/tenants/${tenantId}/roles`, {
  method: "POST",
  headers: { ...authHeaders, "x-step-up-token": grantToken },
  body: JSON.stringify(roleBody),
});
const written = await json(writeResponse);
evidence.writeWithGrantStatus = writeResponse.status;
evidence.roleId = writeResponse.ok ? (written?.id ?? null) : null;
evidence.roleCode = writeResponse.ok ? (written?.code ?? null) : null;
evidence.rolePermissionCount = writeResponse.ok
  ? (written?.permissionCount ?? null)
  : null;
if (writeResponse.status !== 201) {
  throw new Error(
    `granted write HTTP ${writeResponse.status} ${codeOf(written) ?? ""}`.trim(),
  );
}

const replayResponse = await fetch(`${api}/tenants/${tenantId}/roles`, {
  method: "POST",
  headers: { ...authHeaders, "x-step-up-token": grantToken },
  body: JSON.stringify({ ...roleBody, code: `${roleCode}-replay` }),
});
const replay = await json(replayResponse);
evidence.replayStatus = replayResponse.status;
evidence.replayCode = codeOf(replay);

const listResponse = await fetch(`${api}/tenants/${tenantId}/roles`, {
  headers: authHeaders,
});
const list = await json(listResponse);
evidence.roleListStatus = listResponse.status;
evidence.roleListed =
  listResponse.ok && Array.isArray(list)
    ? list.some((role) => role.code === roleCode)
    : false;

await writeFile(
  ".agents/evidence-d58-live-totp.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));
