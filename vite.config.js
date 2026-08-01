import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

let build = 'dev'
try { build = execSync('git rev-parse --short HEAD').toString().trim() } catch (e) {};

export default defineConfig({
  define: { __SOLACE_BUILD__: JSON.stringify(build) },
  build: {
    target: 'es2022',
    // three.js is intentionally a single vendor chunk (~700KB min) — it's the
    // whole engine, splitting it further just adds requests.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // The ship's brain (and R2 media) live on the deployed worker — proxy
    // API calls there so SOLACE answers in local dev too.
    proxy: {
      '/api': 'https://solace.nicholasjprince.workers.dev',
    },
  },
});
