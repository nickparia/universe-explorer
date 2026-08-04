import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const S = '/private/tmp/claude-501/-Users-scorchio-Code-Solace/fc7d1f38-ebac-4b82-b5d2-39cadf638733/scratchpad';
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const build = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = join(cache, build, 'chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem('solace_crew_token_v1', 'DEV-TEST-0001');
  localStorage.setItem('solace_crew_name_v1', 'M. WINCE');
});
await page.goto(`http://localhost:5199/?land=1&solt=${process.env.SOLT || '0.35'}`);
await page.waitForFunction('!!window.__groundLine', null, { timeout: 120000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${S}/land-descent.png` });
await page.waitForTimeout(22000);
await page.screenshot({ path: `${S}/land-ground.png` });
console.log(String(await page.evaluate('window.__groundLine')));
await browser.close();
