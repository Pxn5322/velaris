import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      // Only the core domain and application logic count toward the gate
      // (NFR-03). Generated code, configs, DTO declarations and spec files are
      // excluded by documented rule, not to hide weak coverage.
      include: ['src/domains/**/*.service.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.dto.ts',
        '**/*.interface.ts',
        '**/*.module.ts',
        '**/*.controller.ts',
      ],
      // NFR-03 core-domain target. Below this the coverage run exits non-zero.
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
