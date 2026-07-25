import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js is intentionally a single vendor chunk (~700KB min) — it's the
    // whole engine, splitting it further just adds requests.
    chunkSizeWarningLimit: 1500,
  },
});
