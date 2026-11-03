/**
 * Local environment loading for the API (SETUP_GUIDE.md section 4).
 *
 * The API reads configuration from `process.env` only. Deployments inject real
 * variables; on a developer machine the values live in an ignored `.env` file.
 * This module loads that file with Node's built-in `process.loadEnvFile`, so
 * no runtime dependency is added and no extra package has to be audited.
 *
 * Rules:
 * - Values already present in `process.env` win. `loadEnvFile` never overrides
 *   them, so a host or CI environment is never shadowed by a stray file.
 * - Two locations are honoured, in this order: `<repo>/.env` and
 *   `apps/api/.env`. The first file that defines a name wins.
 * - A missing file is not an error: CI and tests run without one.
 * - Secrets never enter the repository. `.env` and `.env.*` are ignored, and
 *   only placeholder names belong in `.env.example` (SECURITY.md section 7).
 *
 * `main.ts` imports this module first, so every later import sees the values.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// dist/env.js -> apps/api -> repository root (or src/env.ts in a watch run).
const apiDirectory = resolve(import.meta.dirname, '..');
const candidates = [
  resolve(apiDirectory, '../../.env'),
  resolve(apiDirectory, '.env'),
];

for (const file of candidates) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
