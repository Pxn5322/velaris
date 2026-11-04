import { defineConfig } from 'vitest/config';

/**
 * Coverage gate for the evaluation package (T6.02, closing T6.01 gap O-5).
 *
 * The package had a suite after T6.01 but no coverage gate, so a scoring rule
 * could lose its test and the suite would stay green while the threshold that
 * decides whether an agent may publish went unmeasured. The gate below is the
 * same 80% floor apps/api uses for its core domain (NFR-03).
 *
 * Only the source counts: `types.ts` is declarations only, and the spec files
 * are the measurement, not the subject.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', 'src/types.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      reporter: ['text', 'text-summary'],
    },
  },
});
