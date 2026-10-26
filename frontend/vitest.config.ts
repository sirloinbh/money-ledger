// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/vitest/frontend/에서
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // A device clock in UTC: screens must still use the Asia/Seoul service date.
    env: { TZ: 'UTC' },
  },
});
