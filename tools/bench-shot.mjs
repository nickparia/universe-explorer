// Deterministic screenshots of the ship bench (ship-viewer.html).
// Waits for window.__benchReady instead of racing the model load —
// plain `chrome --screenshot` fires before slow GLBs / draco workers finish.
//
//   node tools/bench-shot.mjs "<bench query string>" out.png
//   node tools/bench-shot.mjs "mode=clay&model=beveled" /tmp/clay.png
//
// Needs `npx vite --port 5199` running. Uses the playwright-cached chromium.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [qs = '', out = 'bench.png', delayMs = '0'] = process.argv.slice(2);

const cache = join(homedir(), 'Library/Caches/ms-playwright');
const build = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = join(cache, build, 'chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`http://localhost:5199/ship-viewer.html?${qs}`);
await page.waitForFunction('window.__benchReady === true', null, { timeout: 120000 });
if (+delayMs) await page.waitForTimeout(+delayMs);   // catch animated states (RCS puffs, beacon phase)
await page.screenshot({ path: out });
await browser.close();
console.log(out);
