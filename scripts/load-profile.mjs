#!/usr/bin/env node
/**
 * Repeatable load profile for the fast, non-AI API routes (T6.02, NFR-04).
 *
 * NFR-04 sets p95 < 200 ms for fast non-AI APIs under a documented test
 * load. This script is that documented load: a fixed concurrency, a fixed
 * window per path, keep-alive connections and a warmup that is measured and
 * then discarded. It prints a table and optionally writes the same numbers as
 * JSON, so a report can quote them and a later run can compare.
 *
 * It measures the deployment it is pointed at, so the numbers mean what the
 * target is. Run it against a built API on loopback for a pre-release check
 * (command in docs/TESTING.md section 6), and against the staging origin in
 * T6.03.
 *
 * Usage:
 *   node scripts/load-profile.mjs --url http://127.0.0.1:3100 \
 *     --path / --path "/tickets?tenantId=<uuid>" --concurrency 8 --duration 10
 *
 * An authenticated route takes the credential through `--header`, so a token
 * stays in the shell and never appears in the printed table:
 *
 *   --header "Authorization: Bearer $TOKEN"
 *
 * For a deployment smoke (T6.03), `--auth-signup` creates one synthetic tenant
 * administrator, exchanges the password for a token and fills `{tenantId}` in
 * every path. SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be in the
 * environment. The generated password and the token are never printed, and
 * the JSON report records only the synthetic email and tenant id:
 *
 *   --path "/settings/retention?tenantId={tenantId}" --auth-signup
 *
 * Exit codes: 0 when every path meets the budget, 1 when a budget or error
 * check fails, 2 when the arguments are wrong.
 */

import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_DURATION_SECONDS = 10;
const DEFAULT_WARMUP_SECONDS = 2;
const DEFAULT_BUDGET_MS = 200;

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    url: null,
    paths: [],
    concurrency: DEFAULT_CONCURRENCY,
    duration: DEFAULT_DURATION_SECONDS,
    warmup: DEFAULT_WARMUP_SECONDS,
    budgetMs: DEFAULT_BUDGET_MS,
    out: null,
    headers: {},
    authSignup: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--url":
        options.url = value;
        index += 1;
        break;
      case "--path":
        options.paths.push(value);
        index += 1;
        break;
      case "--concurrency":
        options.concurrency = Number(value);
        index += 1;
        break;
      case "--duration":
        options.duration = Number(value);
        index += 1;
        break;
      case "--warmup":
        options.warmup = Number(value);
        index += 1;
        break;
      case "--budget-ms":
        options.budgetMs = Number(value);
        index += 1;
        break;
      case "--out":
        options.out = value;
        index += 1;
        break;
      case "--auth-signup":
        options.authSignup = true;
        break;
      case "--header": {
        const separator = typeof value === "string" ? value.indexOf(":") : -1;
        if (separator < 1) {
          fail('--header must use the form "Name: value"');
        }
        const name = value.slice(0, separator).trim();
        const headerValue = value.slice(separator + 1).trim();
        if (!/^[A-Za-z0-9-]+$/.test(name) || !headerValue) {
          fail('--header must use the form "Name: value"');
        }
        if (/[\r\n]/.test(headerValue)) {
          fail("--header value must not contain a line break");
        }
        options.headers[name] = headerValue;
        index += 1;
        break;
      }
      default:
        fail(`Unknown argument: ${flag}`);
    }
  }
  if (!options.url) {
    fail("--url is required, for example --url http://127.0.0.1:3100");
  }
  if (options.paths.length === 0) {
    fail("At least one --path is required, for example --path /");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    fail("--concurrency must be a positive integer");
  }
  if (!(options.duration > 0) || !(options.warmup >= 0)) {
    fail("--duration must be positive and --warmup must be zero or more");
  }
  if (
    !options.authSignup &&
    options.paths.some((path) => path.includes("{tenantId}"))
  ) {
    fail("{tenantId} in a path requires --auth-signup");
  }
  if (
    options.authSignup &&
    Object.keys(options.headers).some(
      (name) => name.toLowerCase() === "authorization",
    )
  ) {
    fail(
      "--auth-signup sets the Authorization header; do not pass another one",
    );
  }
  return options;
}

/**
 * Create one synthetic tenant administrator and return its token. The password
 * is generated and never printed, and no response body is echoed in an error.
 */
async function createSyntheticTenant(origin) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl) {
    fail("--auth-signup needs SUPABASE_URL in the environment");
  }
  if (!apiKey) {
    fail("--auth-signup needs SUPABASE_PUBLISHABLE_KEY in the environment");
  }

  const stamp = Date.now().toString(36);
  const email = `loadcheck-${stamp}-${randomBytes(3).toString("hex")}@velaris.test`;
  const password = `Lc!${randomBytes(16).toString("hex")}9a`;

  let signupResponse;
  try {
    signupResponse = await fetch(`${origin}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        tenantName: `Load check ${stamp}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(`POST /auth/signup is unreachable at ${origin}`);
  }
  if (!signupResponse.ok) {
    fail(
      `POST /auth/signup answered HTTP ${signupResponse.status}; check the target and SUPABASE_SERVICE_ROLE_KEY`,
    );
  }
  const signup = await signupResponse.json();
  const tenantId = typeof signup.tenantId === "string" ? signup.tenantId : null;
  if (!tenantId) {
    fail("POST /auth/signup returned no tenantId");
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(
      `${baseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { "content-type": "application/json", apikey: apiKey },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    fail("Supabase Auth is unreachable for the password grant");
  }
  if (!tokenResponse.ok) {
    fail(`Supabase password grant answered HTTP ${tokenResponse.status}`);
  }
  const tokenBody = await tokenResponse.json();
  const token =
    typeof tokenBody.access_token === "string" ? tokenBody.access_token : null;
  if (!token) {
    fail("Supabase password grant returned no access_token");
  }
  return { email, tenantId, token };
}

/** One request; resolves with the status and the elapsed milliseconds. */
function sendOnce(target, agent) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const request = target.request((response) => {
      // The body is drained, not parsed: this measures transport and app
      // time, and an unread body would hold the socket open.
      response.resume();
      response.on("end", () => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        resolve({ status: response.statusCode ?? 0, elapsedMs });
      });
    });
    request.setTimeout(10_000, () => {
      request.destroy(new Error("request timed out after 10 s"));
    });
    request.on("error", reject);
    request.end();
  });
}

/** Nearest-rank percentile over a sorted copy of the samples. */
function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function runWindow(target, agent, concurrency, seconds) {
  const samples = [];
  const statuses = new Map();
  const errors = [];
  const deadline = Date.now() + seconds * 1000;

  async function worker() {
    while (Date.now() < deadline) {
      try {
        const result = await sendOnce(target, agent);
        samples.push(result.elapsedMs);
        statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
        if (result.status >= 500) {
          errors.push(`HTTP ${result.status}`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { samples, statuses, errors };
}

function summarise(path, measured, seconds, errors) {
  const sorted = [...measured].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    path,
    requests: sorted.length,
    requestsPerSecond: round(sorted.length / seconds),
    meanMs: round(total / Math.max(1, sorted.length)),
    p50Ms: round(percentile(sorted, 0.5)),
    p90Ms: round(percentile(sorted, 0.9)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    errorCount: errors.length,
    errorSamples: [...new Set(errors)].slice(0, 3),
  };
}

function formatStatuses(statusCounts) {
  return Object.entries(statusCounts)
    .map(([status, count]) => `${status}x${count}`)
    .join(" ");
}

function formatTable(rows, options) {
  const lines = [];
  lines.push(
    `Load profile against ${options.url} (concurrency ${options.concurrency}, ` +
      `${options.duration}s per path after a ${options.warmup}s warmup, ` +
      `node ${process.version})`,
  );
  lines.push("");
  lines.push(
    "| Path | Statuses | Requests | req/s | mean | p50 | p90 | p95 | p99 | max | Errors |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const row of rows) {
    lines.push(
      `| ${row.path} | ${formatStatuses(row.statusCounts)} | ` +
        `${row.requests} | ${row.requestsPerSecond} | ` +
        `${row.meanMs} | ${row.p50Ms} | ${row.p90Ms} | ${row.p95Ms} | ` +
        `${row.p99Ms} | ${row.maxMs} | ${row.errorCount} |`,
    );
  }
  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const isHttps = options.url.startsWith("https:");
const transport = isHttps ? https : http;
const agentOptions = {
  keepAlive: true,
  maxSockets: options.concurrency,
};
const agent = new transport.Agent(agentOptions);
const base = new URL(options.url);

const origin = `${base.protocol}//${base.host}`;
const auth = options.authSignup ? await createSyntheticTenant(origin) : null;
if (auth) {
  options.headers.Authorization = `Bearer ${auth.token}`;
  options.paths = options.paths.map((path) =>
    path.split("{tenantId}").join(encodeURIComponent(auth.tenantId)),
  );
  process.stdout.write(
    `Synthetic tenant ready: ${auth.email} (tenant ${auth.tenantId})\n`,
  );
}

const results = [];
let budgetFailed = false;

for (const path of options.paths) {
  const target = {
    request: (callback) =>
      transport.request(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port,
          path,
          method: "GET",
          agent,
          headers: { accept: "application/json", ...options.headers },
        },
        callback,
      ),
  };

  // The probe runs first and catches transport failures: a refused port or a
  // bad host must read as a broken target, not as a stack trace from inside
  // the harness.
  let probe;
  try {
    probe = await sendOnce(target, agent);
  } catch (error) {
    fail(
      `Probe of ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (probe.status >= 500) {
    fail(
      `Probe of ${path} answered HTTP ${probe.status}; fix the target before measuring`,
    );
  }
  if (probe.status === 404) {
    // A 404 in the numbers would look fast and prove nothing. On Git Bash a
    // bare `--path /` is also rewritten into a Windows path before Node sees
    // it, so this check turns that mistake into a clear refusal.
    fail(
      `Probe of ${path} answered HTTP 404; the path does not exist on ${options.url}`,
    );
  }

  if (options.warmup > 0) {
    await runWindow(target, agent, options.concurrency, options.warmup);
  }

  const window = await runWindow(
    target,
    agent,
    options.concurrency,
    options.duration,
  );
  const row = summarise(path, window.samples, options.duration, window.errors);
  results.push({
    ...row,
    statusCounts: Object.fromEntries(
      [...window.statuses.entries()].sort((left, right) => left[0] - right[0]),
    ),
  });
  if (row.p95Ms > options.budgetMs || row.errorCount > 0) {
    budgetFailed = true;
  }
}

agent.destroy();

process.stdout.write(formatTable(results, options) + "\n");
process.stdout.write(
  `\nBudget: p95 <= ${options.budgetMs} ms and zero server errors (NFR-04).\n`,
);
for (const row of results) {
  const verdict =
    row.p95Ms <= options.budgetMs && row.errorCount === 0 ? "pass" : "fail";
  process.stdout.write(
    `${verdict} ${row.path} p95 ${row.p95Ms} ms, ${row.errorCount} error(s)\n`,
  );
  if (row.errorSamples.length > 0) {
    process.stdout.write(`    first errors: ${row.errorSamples.join("; ")}\n`);
  }
}

if (options.out) {
  const report = {
    generatedAt: new Date().toISOString(),
    target: options.url,
    concurrency: options.concurrency,
    durationSecondsPerPath: options.duration,
    warmupSeconds: options.warmup,
    budgetMs: options.budgetMs,
    node: process.version,
    auth: auth
      ? { mode: "signup", email: auth.email, tenantId: auth.tenantId }
      : undefined,
    results,
  };
  writeFileSync(options.out, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`\nJSON written to ${options.out}\n`);
}

process.exit(budgetFailed ? 1 : 0);
