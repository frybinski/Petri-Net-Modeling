import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The deploy workflow sets VITE_BASE=/Petri-Net-Modeling/ for GitHub Pages.
const base = process.env.VITE_BASE ?? '/';

// To try the app against a running server during development: `PNM_DEV_SERVER=http://localhost:8080
// pnpm dev` passes /api and /llm on to it, so that the app finds the server like it would in the
// container.
const devServer = process.env.PNM_DEV_SERVER;

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
    ...(devServer !== undefined && {
      proxy: {
        '/api': { target: devServer, changeOrigin: false },
        '/llm': { target: devServer, changeOrigin: false },
      },
    }),
  },
  // The simulation engine runs in a module worker (see @pnm/sim/worker-client).
  worker: { format: 'es' },
  build: {
    // The layout engine (ELK, ~1.4 MB) is loaded on demand in its own chunk.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Some tests wait for animation frames and a worker; a busy machine (a Playwright run next to
    // the unit tests) must not turn that into a failure.
    testTimeout: 30_000,
  },
});
