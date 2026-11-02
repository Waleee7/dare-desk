import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'dashboard/app/lib/**/*.test.ts'],
    environment: 'node',
  },
});
