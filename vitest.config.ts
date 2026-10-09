import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Avoid saturating high-core hosts: workflow tests intentionally retain tight wait budgets.
    maxWorkers: 4,
  },
});
