// npm audit baseline gate.
//
// Runs `npm audit --json` and compares the result against
// scripts/audit-baseline.json (a package -> severity map). The job fails when:
//   1. audit reports a package that is not in the baseline (new vulnerability), or
//   2. a package's severity exceeds its baseline severity (severity increase).
//
// When the team fixes a baseline vulnerability, the script prints the removed
// packages. Update the baseline in the same change so the gate stays tight.
// Baseline entries are never ignored silently: a fixed entry only reports info.
//
// Exit codes: 0 = no new drift, 1 = new or upgraded vulnerability, 2 = audit
// could not run (registry or output problem). Exit 2 fails CI on purpose so a
// broken audit never reads as a pass.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'audit-baseline.json');
const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

let raw;
try {
  // execSync runs through the platform shell (cmd.exe on Windows, sh on
  // Linux), which resolves the npm launcher without a shell+args deprecation.
  raw = execSync('npm audit --json', {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  // npm audit exits 1 when it finds vulnerabilities; JSON is still on stdout.
  if (error.stdout && error.stdout.length > 0) {
    raw = error.stdout;
  } else {
    console.error(`audit-baseline: npm audit could not run: ${error.message}`);
    process.exit(2);
  }
}

let audit;
try {
  audit = JSON.parse(raw);
} catch {
  console.error('audit-baseline: npm audit did not return valid JSON.');
  process.exit(2);
}

if (!audit.vulnerabilities || typeof audit.vulnerabilities !== 'object') {
  console.error('audit-baseline: unexpected npm audit output shape.');
  process.exit(2);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (error) {
  console.error(`audit-baseline: cannot read baseline: ${error.message}`);
  process.exit(2);
}

const failures = [];
const resolved = [];

for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
  const severity = vuln.severity;
  if (!(name in baseline)) {
    failures.push(`NEW ${severity}: ${name} (not in baseline)`);
  } else if (rank[severity] > rank[baseline[name]]) {
    failures.push(
      `SEVERITY UP ${baseline[name]} -> ${severity}: ${name}`,
    );
  }
}

for (const name of Object.keys(baseline)) {
  if (!(name in audit.vulnerabilities)) resolved.push(name);
}

const counts = audit.metadata?.vulnerabilities ?? {};
console.log(
  `audit-baseline: current audit reports ${counts.total ?? Object.keys(audit.vulnerabilities).length} vulnerabilities ` +
    `(critical ${counts.critical ?? '?'}, high ${counts.high ?? '?'}, moderate ${counts.moderate ?? '?'}, low ${counts.low ?? '?'}).`,
);

if (resolved.length > 0) {
  console.log(
    `audit-baseline: fixed since baseline: ${resolved.join(', ')}. Remove these entries from scripts/audit-baseline.json.`,
  );
}

if (failures.length > 0) {
  console.error('audit-baseline: FAIL - new dependency vulnerabilities detected:');
  for (const line of failures) console.error(`  ${line}`);
  console.error('Fix with npm audit fix or an upgrade. Only record a new baseline entry after owner review.');
  process.exit(1);
}

console.log('audit-baseline: PASS - no new vulnerabilities beyond the recorded baseline.');
