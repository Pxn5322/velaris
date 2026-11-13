#!/usr/bin/env node
/**
 * Hosted T6.03 smoke checks (2026-11-10 deployment follow-up).
 *
 * Creates one synthetic tenant, then checks:
 * - the web icon route returns SVG,
 * - the session display name matches the synthetic account,
 * - a valid avatar_url returns in a fresh session and is omitted after clear,
 * - an authenticated retention read returns 200,
 * - a foreign tenant read is denied with 403,
 * - a retention save returns the new window,
 * - the audit trail contains the matching retention.policy_changed row.
 *
 * Usage:
 *   node --env-file=.env scripts/deployment-smoke.mjs \
 *     --url https://api.example.com --web-url https://web.example.com
 *
 * Required environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.
 * The synthetic account is `smokecheck-*@velaris.test`; remove it with
 * scripts/cleanup-load-tenants.mjs. The script never prints a token or password.
 */

import { randomBytes } from "node:crypto";

const FOREIGN_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseOrigin(argument, environmentName) {
  const index = process.argv.indexOf(argument);
  const value =
    index >= 0 ? process.argv[index + 1] : process.env[environmentName];
  if (!value) {
    throw new Error(`Pass ${argument} <origin> or set ${environmentName}`);
  }
  return value.replace(/\/+$/, "");
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function passwordGrant(supabaseUrl, publishableKey, email, password) {
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
  return { status: response.status, token: body?.access_token ?? null };
}

async function main() {
  const apiUrl = parseOrigin("--url", "SMOKE_API_URL");
  const webUrl = parseOrigin("--web-url", "SMOKE_WEB_URL");
  const supabaseUrl = requireEnvironment("SUPABASE_URL").replace(/\/+$/, "");
  const publishableKey = requireEnvironment("SUPABASE_PUBLISHABLE_KEY");
  const checks = {};
  let email = null;
  let tenantId = null;
  let token = null;

  try {
    const icon = await fetch(`${webUrl}/icon.svg`, {
      headers: { accept: "image/svg+xml" },
    });
    const iconBody = await icon.text();
    const iconContentType = (icon.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim();
    checks.icon = icon.status;
    checks.iconContentType = iconContentType;
    if (
      !icon.ok ||
      iconContentType !== "image/svg+xml" ||
      !iconBody.includes("<svg")
    ) {
      throw new Error(
        `web icon failed with HTTP ${icon.status} and content type ${iconContentType || "none"}`,
      );
    }

    const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
    email = `smokecheck-${stamp}@velaris.test`;
    const password = `Synthetic-${randomBytes(8).toString("hex")}!`;
    const tenantName = `Smoke check ${stamp}`;

    const signup = await fetch(`${apiUrl}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, tenantName }),
    });
    const signupBody = await readJson(signup);
    checks.signup = signup.status;
    if (!signup.ok || !signupBody?.tenantId) {
      throw new Error(
        `signup failed with HTTP ${signup.status}: ${JSON.stringify(signupBody)}`,
      );
    }
    tenantId = signupBody.tenantId;

    const login = await passwordGrant(
      supabaseUrl,
      publishableKey,
      email,
      password,
    );
    checks.login = login.status;
    if (!login.token) {
      throw new Error(`password grant failed with HTTP ${login.status}`);
    }
    token = login.token;

    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const session = await fetch(`${apiUrl}/auth/session`, {
      headers: authHeaders,
    });
    const sessionBody = await readJson(session);
    checks.session = session.status;
    const sessionDisplayName = sessionBody?.tenantContext?.displayName;
    checks.sessionDisplayName =
      sessionDisplayName === email ? "matches" : "mismatch";
    if (!session.ok || sessionDisplayName !== email) {
      throw new Error(
        `session display name check failed with HTTP ${session.status}`,
      );
    }

    const avatarUrl = `${webUrl}/icon.svg`;
    const avatarUpdate = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: { avatar_url: avatarUrl } }),
    });
    checks.avatarUpdate = avatarUpdate.status;
    if (!avatarUpdate.ok) {
      throw new Error(`avatar update failed with HTTP ${avatarUpdate.status}`);
    }

    const avatarLogin = await passwordGrant(
      supabaseUrl,
      publishableKey,
      email,
      password,
    );
    checks.avatarLogin = avatarLogin.status;
    if (!avatarLogin.token) {
      throw new Error(`avatar login failed with HTTP ${avatarLogin.status}`);
    }
    const avatarSession = await fetch(`${apiUrl}/auth/session`, {
      headers: { authorization: `Bearer ${avatarLogin.token}` },
    });
    const avatarSessionBody = await readJson(avatarSession);
    const avatarSessionUrl = avatarSessionBody?.identity?.avatarUrl;
    checks.avatarSession = avatarSession.status;
    checks.avatarSessionUrl =
      avatarSessionUrl === avatarUrl ? "matches" : "mismatch";
    if (!avatarSession.ok || avatarSessionUrl !== avatarUrl) {
      throw new Error(
        `avatar session check failed with HTTP ${avatarSession.status}`,
      );
    }

    const avatarClear = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${avatarLogin.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: { avatar_url: null } }),
    });
    checks.avatarClear = avatarClear.status;
    if (!avatarClear.ok) {
      throw new Error(`avatar clear failed with HTTP ${avatarClear.status}`);
    }

    const fallbackLogin = await passwordGrant(
      supabaseUrl,
      publishableKey,
      email,
      password,
    );
    checks.fallbackLogin = fallbackLogin.status;
    if (!fallbackLogin.token) {
      throw new Error(
        `fallback login failed with HTTP ${fallbackLogin.status}`,
      );
    }
    const fallbackSession = await fetch(`${apiUrl}/auth/session`, {
      headers: { authorization: `Bearer ${fallbackLogin.token}` },
    });
    const fallbackSessionBody = await readJson(fallbackSession);
    const fallbackIdentity = fallbackSessionBody?.identity ?? {};
    const fallbackOmitted = !("avatarUrl" in fallbackIdentity);
    checks.fallbackSession = fallbackSession.status;
    checks.avatarFallback = fallbackOmitted ? "omitted" : "present";
    if (!fallbackSession.ok || !fallbackOmitted) {
      throw new Error(
        `avatar fallback check failed with HTTP ${fallbackSession.status}`,
      );
    }

    const own = await fetch(
      `${apiUrl}/settings/retention?tenantId=${encodeURIComponent(tenantId)}`,
      { headers: authHeaders },
    );
    const ownBody = await readJson(own);
    checks.ownRead = own.status;
    if (!own.ok || !Array.isArray(ownBody?.policies)) {
      throw new Error(`own retention read failed with HTTP ${own.status}`);
    }

    const foreign = await fetch(
      `${apiUrl}/settings/retention?tenantId=${FOREIGN_TENANT_ID}`,
      { headers: authHeaders },
    );
    checks.crossTenant = foreign.status;
    if (foreign.status !== 403) {
      throw new Error(`cross-tenant read returned HTTP ${foreign.status}`);
    }

    const saved = await fetch(`${apiUrl}/settings/retention`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        tenantId,
        category: "TRACES",
        retentionDays: 45,
      }),
    });
    const savedBody = await readJson(saved);
    checks.save = saved.status;
    if (!saved.ok || savedBody?.retentionDays !== 45) {
      throw new Error(`retention save failed with HTTP ${saved.status}`);
    }

    const audit = await fetch(
      `${apiUrl}/audit/events?tenantId=${encodeURIComponent(tenantId)}&limit=10&action=retention.policy_changed`,
      { headers: authHeaders },
    );
    const auditBody = await readJson(audit);
    checks.audit = audit.status;
    const matched = Array.isArray(auditBody?.items)
      ? auditBody.items.find(
          (event) =>
            event?.metadata?.category === "TRACES" &&
            event?.metadata?.retentionDays === 45,
        )
      : null;
    if (!audit.ok || !matched) {
      throw new Error("retention audit row was not found");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          email,
          tenantId,
          checks,
          auditEventId: matched.id,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          email,
          tenantId,
          checks,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
