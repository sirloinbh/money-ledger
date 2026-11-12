// Managed file. Edit it in sirloinbh/project-standards templates/vitest/frontend/
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // A device clock in UTC: screens must still use the Asia/Seoul service date.
    env: { TZ: 'UTC' },
    // Screen tests slow down a lot when the same PC is busy, and a slow PC is not a failure.
    testTimeout: 15_000,
  },
});
