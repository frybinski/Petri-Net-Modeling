import { defineConfig } from 'vitest/config';
import { embeddedDefines } from './scripts/embedded.ts';

export default defineConfig({
  define: embeddedDefines(),
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Some tests start the bundled server or the job pool, which loads the bundle in a thread.
    testTimeout: 60_000,
  },
});
