import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The property tests (fast-check) run hundreds of generated nets. They take a few seconds on
    // an idle machine and much longer on a shared CI runner that runs other packages at the same
    // time, so the limit is generous. The number of runs stays as it is.
    testTimeout: 60_000,
  },
});
