#!/usr/bin/env node
/**
 * Route inventory and authorization check (T6.02, NFR-02).
 *
 * NFR-02 needs 100% of protected APIs to enforce authentication and the
 * required permissions, and its stated evidence is API denial tests plus a
 * route inventory review. The denial tests exist. This script is the
 * inventory: it reads every Nest controller, lists each route with the
 * guards and permission codes declared on it, and fails when a route is
 * protected by neither.
 *
 * Three routes are public on purpose. Each is listed below with the reason,
 * so a new unprotected route cannot borrow the exemption by accident.
 *
 * Exit codes: 0 when every route is accounted for, 1 on a finding, 2 when a
 * source file cannot be read or parses to zero routes.
 *
 * Usage: node scripts/check-route-inventory.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const CONTROLLERS_ROOT = "apps/api/src";
const PERMISSION_SOURCE =
  "apps/api/src/domains/permissions/permission.codes.ts";

const HTTP_METHODS = ["Get", "Post", "Put", "Patch", "Delete"];

/**
 * Routes that answer without a bearer token. `permission` says whether the
 * route also needs no permission code.
 */
const PUBLIC_ROUTES = [
  {
    controller: "app.controller.ts",
    handler: "getHello",
    reason:
      "Public liveness probe: no data, used by the boot spec and the load profile",
  },
  {
    controller: "domains/auth/auth.controller.ts",
    handler: "signup",
    reason:
      "Public registration (AC-F01-2): there is no caller yet, and validation runs before the identity provider is touched",
  },
  {
    controller: "domains/integrations/integrations.controller.ts",
    handler: "deliver",
    reason:
      "Inbound webhook: authenticated by the signed delivery (AC-F13-1), not by a bearer token",
  },
];

/** Routes that require authentication but declare no resource permission. */
const AUTHENTICATED_WITHOUT_PERMISSION = [
  {
    controller: "domains/auth/auth.controller.ts",
    handler: "session",
    reason:
      "Identity bootstrap: the caller reads its own session, so there is no resource to scope",
  },
];

function listControllerFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...listControllerFiles(path));
    } else if (
      entry.endsWith(".controller.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      found.push(path);
    }
  }
  return found.sort();
}

function readPermissionCodes() {
  const source = readFileSync(PERMISSION_SOURCE, "utf8");
  const codes = new Map();
  for (const match of source.matchAll(
    /([A-Z][A-Z0-9_]*):\s*'([a-z][a-z0-9.]*)'/g,
  )) {
    codes.set(match[1], match[2]);
  }
  return codes;
}

/** Collect decorator lines, then attach them to the following method. */
function parseController(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let prefix = "";
  let classDecorators = [];
  const routes = [];

  // Decorators seen since the last method signature, plus the block they
  // belong to (class level or handler level).
  let pending = [];
  let insideClass = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("@")) {
      pending.push(trimmed);
      continue;
    }
    if (/^export class \w+/.test(trimmed)) {
      const controllerLine = pending.find((entry) =>
        entry.startsWith("@Controller("),
      );
      prefix = controllerLine
        ? (controllerLine.match(/@Controller\('([^']*)'\)/)?.[1] ?? "")
        : "";
      classDecorators = pending.filter((entry) =>
        entry.startsWith("@UseGuards("),
      );
      insideClass = true;
      pending = [];
      continue;
    }
    const methodMatch = /^(?:async\s+)?([A-Za-z_]\w*)\s*\(/.exec(trimmed);
    if (insideClass && methodMatch && pending.length > 0) {
      const httpLine = pending.find((entry) =>
        HTTP_METHODS.some((method) => entry.startsWith(`@${method}(`)),
      );
      if (httpLine) {
        const verb = HTTP_METHODS.find((method) =>
          httpLine.startsWith(`@${method}(`),
        );
        const suffix = httpLine.match(/@\w+\('([^']*)'\)/)?.[1] ?? "";
        const fullPath =
          ("/" + [prefix, suffix].filter(Boolean).join("/")).replace(
            /\/+$/,
            "",
          ) || "/";
        routes.push({
          file: relative(CONTROLLERS_ROOT, path).split(sep).join("/"),
          handler: methodMatch[1],
          method: verb.toUpperCase(),
          path: fullPath,
          decorators: [...classDecorators, ...pending],
        });
      }
      pending = [];
      continue;
    }
    if (!trimmed.startsWith("//") && !trimmed.startsWith("*")) {
      pending = [];
    }
  }
  return routes;
}

function declaredPermissions(decorators) {
  const codes = [];
  for (const entry of decorators) {
    if (!entry.startsWith("@RequirePermission(")) {
      continue;
    }
    for (const match of entry.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)) {
      codes.push(match[1]);
    }
  }
  return codes;
}

function isAuthenticated(decorators) {
  return decorators.some((entry) => entry.includes("SupabaseAuthGuard"));
}

const knownCodes = readPermissionCodes();
const files = listControllerFiles(CONTROLLERS_ROOT);
const routes = files.flatMap(parseController);

if (routes.length === 0) {
  process.stderr.write(
    `No routes parsed from ${files.length} controller file(s); the parser no longer matches the source\n`,
  );
  process.exit(2);
}

const findings = [];
const rows = [];

for (const route of routes) {
  const publicEntry = PUBLIC_ROUTES.find(
    (entry) =>
      entry.controller === route.file && entry.handler === route.handler,
  );
  const selfOnly = AUTHENTICATED_WITHOUT_PERMISSION.find(
    (entry) =>
      entry.controller === route.file && entry.handler === route.handler,
  );
  const permissions = declaredPermissions(route.decorators);
  const authenticated = isAuthenticated(route.decorators);

  for (const code of permissions) {
    if (!knownCodes.has(code)) {
      findings.push(
        `${route.method} ${route.path} (${route.handler}) declares unknown permission ${code}`,
      );
    }
  }

  if (publicEntry) {
    rows.push({
      ...route,
      auth: "public",
      permissions: permissions.join(", ") || "-",
      note: publicEntry.reason,
    });
    continue;
  }

  if (!authenticated) {
    findings.push(
      `${route.method} ${route.path} (${route.handler}) has no authentication guard and is not on the public list`,
    );
  }
  if (permissions.length === 0) {
    if (selfOnly) {
      rows.push({
        ...route,
        auth: "bearer",
        permissions: "-",
        note: selfOnly.reason,
      });
      continue;
    }
    findings.push(
      `${route.method} ${route.path} (${route.handler}) declares no permission code`,
    );
  }
  rows.push({
    ...route,
    auth: authenticated ? "bearer" : "none",
    permissions: permissions.join(", ") || "-",
    note: authenticated ? "" : "missing auth guard",
  });
}

process.stdout.write(
  `Route inventory: ${routes.length} route(s) in ${files.length} controller file(s)\n\n`,
);
process.stdout.write("| Method | Path | Handler | Auth | Permissions |\n");
process.stdout.write("| --- | --- | --- | --- | --- |\n");
for (const row of rows) {
  process.stdout.write(
    `| ${row.method} | ${row.path} | ${row.handler} | ${row.auth} | ${row.permissions} |\n`,
  );
}

const declared = rows.filter((row) => row.permissions !== "-").length;
const publicCount = rows.filter((row) => row.auth === "public").length;
process.stdout.write(
  `\n${rows.length - publicCount} protected route(s), ${publicCount} documented public route(s); ` +
    `${declared} route(s) declare at least one permission code\n`,
);

if (findings.length > 0) {
  process.stdout.write("\nFindings:\n");
  for (const finding of findings) {
    process.stdout.write(`- ${finding}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  "\nEvery route is authenticated and permission-scoped, or on the documented public list.\n",
);
