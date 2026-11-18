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
import { pathToFileURL } from "node:url";

const CONTROLLERS_ROOT = "apps/api/src";
const PERMISSION_SOURCE =
  "apps/api/src/domains/permissions/permission.codes.ts";
const STEP_UP_SOURCE = "apps/api/src/domains/auth/step-up.service.ts";

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
  {
    controller: "domains/auth/auth.controller.ts",
    handler: "signout",
    reason:
      "Self-service session revocation: the caller can revoke only its own bearer token",
  },
  {
    controller: "domains/auth/auth.controller.ts",
    handler: "updateProfile",
    reason:
      "Self-service profile edit: the caller writes only its own name and avatar",
  },
  {
    controller: "domains/auth/auth-security.controller.ts",
    handler: "stepUp",
    reason:
      "Self-service re-authentication: the caller proves its own password and receives a grant bound to its own session",
  },
  {
    controller: "domains/auth/auth-security.controller.ts",
    handler: "changePassword",
    reason:
      "Self-service password change: the caller changes only its own password and must prove the current one",
  },
  {
    controller: "domains/auth/auth-security.controller.ts",
    handler: "revokeSessions",
    reason:
      "Self-service session revocation: the caller revokes only its own sessions and must present a step-up grant",
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

function readQuotedConstants(source) {
  const constants = new Map();
  for (const match of source.matchAll(
    /([A-Z][A-Z0-9_]*):\s*'([a-z][a-z0-9.]*)'/g,
  )) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

function readPermissionCodes() {
  const source = readFileSync(PERMISSION_SOURCE, "utf8");
  const block =
    /export const PERMISSIONS = \{([\s\S]*?)\n\} as const;/.exec(source)?.[1] ?? "";
  return readQuotedConstants(block);
}

/** Map each STEP_UP_ACTIONS key to its action code and MFA policy. */
function readStepUpActions() {
  const source = readFileSync(STEP_UP_SOURCE, "utf8");
  const actionsBlock =
    /export const STEP_UP_ACTIONS = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
  const codes = readQuotedConstants(actionsBlock);
  const policy = /const ACTION_POLICY[\s\S]*?\n};/.exec(source)?.[0] ?? "";
  const mfa = new Map();
  for (const match of policy.matchAll(
    /\[STEP_UP_ACTIONS\.([A-Z0-9_]+)\]:\s*\{\s*mfa:\s*(true|false)/g,
  )) {
    mfa.set(match[1], match[2] === "true");
  }
  const actions = new Map();
  for (const [key, code] of codes) {
    actions.set(key, { code, mfa: mfa.get(key) ?? null });
  }
  return actions;
}

/**
 * Join a decorator that spans several lines into one entry. This keeps the
 * line-oriented parser correct after Prettier wraps a long decorator.
 */
export function collapseDecorators(source) {
  const lines = source.split(/\r?\n/);
  const collapsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let text = line.trim();
    if (!text.startsWith("@")) {
      collapsed.push(line);
      continue;
    }
    let depth = bracketDepth(text);
    while (depth > 0 && index + 1 < lines.length) {
      index += 1;
      text += ` ${lines[index].trim()}`;
      depth = bracketDepth(text);
    }
    collapsed.push(text);
  }
  return collapsed;
}

function bracketDepth(text) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (const character of text) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth -= 1;
    }
  }
  return depth;
}

/** Collect decorator lines, then attach them to the following method. */
function parseController(path) {
  return parseControllerSource(
    readFileSync(path, "utf8"),
    relative(CONTROLLERS_ROOT, path).split(sep).join("/"),
  );
}

export function parseControllerSource(source, file) {
  const lines = collapseDecorators(source);
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
        ? (controllerLine.match(/@Controller\(\s*'([^']*)'/)?.[1] ?? "")
        : "";
      classDecorators = pending.filter(
        (entry) => !entry.startsWith("@Controller("),
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
        const suffix = httpLine.match(/@\w+\(\s*'([^']*)'/)?.[1] ?? "";
        const fullPath =
          ("/" + [prefix, suffix].filter(Boolean).join("/")).replace(
            /\/+$/,
            "",
          ) || "/";
        routes.push({
          file,
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

export function declaredPermissions(decorators) {
  return decorators
    .filter((entry) => entry.startsWith("@RequirePermission("))
    .flatMap((entry) =>
      [...entry.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)].map(
        (match) => match[1],
      ),
    );
}

export function declaredStepUp(decorators) {
  const entries = decorators.filter((entry) =>
    entry.startsWith("@RequireStepUp("),
  );
  const actions = entries.flatMap((entry) =>
    [...entry.matchAll(/STEP_UP_ACTIONS\.([A-Z0-9_]+)/g)].map(
      (match) => match[1],
    ),
  );
  return { actions, malformed: entries.length > 0 && actions.length === 0 };
}

function hasGuard(decorators, name) {
  const pattern = new RegExp(`\\b${name}\\b`);
  return decorators.some(
    (entry) => entry.startsWith("@UseGuards(") && pattern.test(entry),
  );
}

export function isAuthenticated(decorators) {
  return hasGuard(decorators, "SupabaseAuthGuard");
}

export function hasStepUpGuard(decorators) {
  return hasGuard(decorators, "StepUpGuard");
}

export function assuranceLabel(keys, knownActions) {
  if (keys.length === 0) return "-";
  return keys
    .map((key) => {
      const action = knownActions.get(key);
      if (!action) return `unknown:${key}`;
      if (action.mfa === null) return `no-policy:${action.code}`;
      return action.mfa
        ? `mfa+step-up:${action.code}`
        : `step-up:${action.code}`;
    })
    .join(", ");
}

export function run() {
  const knownCodes = readPermissionCodes();
  const knownStepUps = readStepUpActions();
  if (knownStepUps.size === 0) {
    process.stderr.write(
      `No step-up actions parsed from ${STEP_UP_SOURCE}; the parser no longer matches the source\n`,
    );
    process.exit(2);
  }
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
    const stepUp = declaredStepUp(route.decorators);
    const stepUpGuarded = hasStepUpGuard(route.decorators);
    const assurance = assuranceLabel(stepUp.actions, knownStepUps);

    for (const code of permissions) {
      if (!knownCodes.has(code)) {
        findings.push(
          `${route.method} ${route.path} (${route.handler}) declares unknown permission ${code}`,
        );
      }
    }
    for (const key of stepUp.actions) {
      const action = knownStepUps.get(key);
      if (!action) {
        findings.push(
          `${route.method} ${route.path} (${route.handler}) declares unknown step-up action ${key}`,
        );
      } else if (action.mfa === null) {
        findings.push(
          `${route.method} ${route.path} (${route.handler}) step-up action ${action.code} has no MFA policy`,
        );
      }
    }
    if (stepUp.malformed) {
      findings.push(
        `${route.method} ${route.path} (${route.handler}) declares a step-up action that is not a STEP_UP_ACTIONS constant`,
      );
    }
    if (stepUp.actions.length > 0 && !stepUpGuarded) {
      findings.push(
        `${route.method} ${route.path} (${route.handler}) declares step-up but has no StepUpGuard`,
      );
    }
    if (stepUpGuarded && stepUp.actions.length === 0) {
      findings.push(
        `${route.method} ${route.path} (${route.handler}) has StepUpGuard but declares no step-up action`,
      );
    }
    if (stepUp.actions.length > 0 && !authenticated) {
      findings.push(
        `${route.method} ${route.path} (${route.handler}) declares step-up without SupabaseAuthGuard`,
      );
    }

    if (publicEntry) {
      rows.push({
        ...route,
        auth: "public",
        permissions: permissions.join(", ") || "-",
        assurance,
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
          assurance,
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
      assurance,
      note: authenticated ? "" : "missing auth guard",
    });
  }

  process.stdout.write(
    `Route inventory: ${routes.length} route(s) in ${files.length} controller file(s)\n\n`,
  );
  process.stdout.write(
    "| Method | Path | Handler | Auth | Permissions | Assurance |\n",
  );
  process.stdout.write("| --- | --- | --- | --- | --- | --- |\n");
  for (const row of rows) {
    process.stdout.write(
      `| ${row.method} | ${row.path} | ${row.handler} | ${row.auth} | ${row.permissions} | ${row.assurance} |\n`,
    );
  }

  const declared = rows.filter((row) => row.permissions !== "-").length;
  const publicCount = rows.filter((row) => row.auth === "public").length;
  const stepUpCount = rows.filter((row) => row.assurance !== "-").length;
  const mfaCount = rows.filter((row) =>
    row.assurance.includes("mfa+step-up:"),
  ).length;
  process.stdout.write(
    `\n${rows.length - publicCount} protected route(s), ${publicCount} documented public route(s); ` +
      `${declared} route(s) declare at least one permission code; ` +
      `${stepUpCount} route(s) declare step-up protection (${mfaCount} require MFA)\n`,
  );

  if (findings.length > 0) {
    process.stdout.write("\nFindings:\n");
    for (const finding of findings) {
      process.stdout.write(`- ${finding}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    "\nEvery route is authenticated and permission-scoped, or on the documented public list. " +
      "Every step-up declaration has a StepUpGuard and a known MFA policy.\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run();
}
