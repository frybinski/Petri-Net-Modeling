import { defineConfig } from 'vitest/config';
import { embeddedDefines } from './scripts/embedded.ts';

export default defineConfig({
  define: embeddedDefines(),
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Most tests start the bundled program in a child process.
    testTimeout: 60_000,
  },
});
