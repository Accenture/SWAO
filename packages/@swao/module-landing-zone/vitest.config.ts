import { defineConfig } from 'vitest/config';

// #4278: tests run on a temporary user profile (src/__tests__/sandbox-profile.ts).
export default defineConfig({
  test: {
    setupFiles: ['src/__tests__/sandbox-profile.ts'],
  },
});
