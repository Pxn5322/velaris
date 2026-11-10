#!/usr/bin/env node
/**
 * Hosted T6.03 smoke checks (2026-11-10 deployment follow-up).
 *
 * Creates one synthetic tenant, then checks:
 * - an authenticated retention read returns 200,
 * - a foreign tenant read is denied with 403,
 * - a retention save returns the new window,
 * - the audit trail contains the matching retention.policy_changed row.
 *
 * Usage:
 *   node --env-file=.env scripts/deployment-smoke.mjs --url https://api.example.com
 *
 * Required environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.
 * The synthetic account is `smokecheck-*@velaris.test`; remove it with
 * scripts/cleanup-load-tenants.mjs. The script never prints a token or password.
 */

import { randomBytes } from 'node:crypto';

const FOREIGN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseUrl() {
  const index = process.argv.indexOf('--url');
  const value = index >= 0 ? process.argv[index + 1] : process.env.SMOKE_API_URL;
  if (!value) {
    throw new Error('Pass --url <api-origin> or set SMOKE_API_URL');
  }
  return value.replace(/\/+$/, '');
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

async function main() {
  const apiUrl = parseUrl();
  const supabaseUrl = requireEnvironment('SUPABASE_URL').replace(/\/+$/, '');
  const publishableKey = requireEnvironment('SUPABASE_PUBLISHABLE_KEY');
  const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const email = `smokecheck-${stamp}@velaris.test`;
  const password = `Synthetic-${randomBytes(8).toString('hex')}!`;
  const tenantName = `Smoke check ${stamp}`;
  const checks = {};
  let tenantId = null;
  let token = null;

  try {
    const signup = await fetch(`${apiUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

    const grant = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      },
    );
    const grantBody = await readJson(grant);
    checks.login = grant.status;
    if (!grant.ok || !grantBody?.access_token) {
      throw new Error(`password grant failed with HTTP ${grant.status}`);
    }
    token = grantBody.access_token;

    const authHeaders = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };

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
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        tenantId,
        category: 'TRACES',
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
            event?.metadata?.category === 'TRACES' &&
            event?.metadata?.retentionDays === 45,
        )
      : null;
    if (!audit.ok || !matched) {
      throw new Error('retention audit row was not found');
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
