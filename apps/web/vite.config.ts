import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The deploy workflow sets VITE_BASE=/Petri-Net-Modeling/ for GitHub Pages.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: false },
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
  },
});
