import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        'examples/**',
        'site/**',
        '.venv/**',
        '**/*.d.ts',
        'src/**/__tests__/**',
        'src/test-registration.ts',
      ],
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 30,
        lines: 30,
      },
    },
  },
});
