// tools/ship-shot.mjs — aimed screenshots of the SOLACE on her pad.
//
// The ground engine hides her from a wrongly-aimed camera as effectively
// as a bug would, so shots are AIMED, never hunted: __shipDbg() reports
// her real extent and __groundTP() puts the eye where you asked.
//
//   OUT=/path/to/dir node tools/ship-shot.mjs
//
// Heading convention (controller.js:199): fwd = (−sin yaw, 0, −cos yaw),
// so looking from C at T is yaw = atan2(−dx, −dz). Getting this backwards
// costs a full 30 s boot per wrong guess.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OUT = process.env.OUT || '.';
const PORT = process.env.PORT || '5199';
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const build = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = join(cache, build, 'chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
// ?land=1 boots straight to the ground, but the cryo-wake terminal still
// gates it — a fake crew token has to be in place BEFORE first script.
await page.addInitScript(() => {
  localStorage.setItem('solace_crew_token_v1', 'DEV-TEST-0001');
  localStorage.setItem('solace_crew_name_v1', 'M. WINCE');
});
await page.goto(`http://localhost:${PORT}/?land=1&solt=${process.env.SOLT || '0.35'}`);
await page.waitForFunction('!!window.__shipDbg', null, { timeout: 120000 });
await page.waitForTimeout(30000);            // descent + GLB + terrain settle
console.log('ship:', JSON.stringify(await page.evaluate('window.__shipDbg()')));

const aim = (cx, cz, tx, tz) => Math.atan2(-(tx - cx), -(tz - cz));
// She lies east–west at (36,−6): hull x −95…161, beam z −36…24, 63 m tall.
// cam x, cam z, look-at x, look-at z, pitch
const SHOTS = [
  ['bootfall',   16,   18,  16,  -6, 0.42],   // where the traveler steps out
  ['at-a-leg',   36,   38,  36,  11, 0.45],   // eye against a gear pad
  ['alongside',  36,   95,  36,  -6, 0.16],   // her whole flank
  ['wide',       36,  420,  36,  -6, 0.05],   // far enough to hold all of her
  ['from-bow',  250,   -6, 100,  -6, 0.10],   // down her length from the bow
  ['from-lip',   36, -110,  36,  -6, 0.12],   // from below the escarpment lip
];
for (const [name, cx, cz, tx, tz, pitch] of SHOTS) {
  await page.evaluate(`window.__groundTP(${cx}, ${cz}, ${aim(cx, cz, tx, tz)}, ${pitch})`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, `ship-${name}.png`) });
  console.log('  ', name);
}
await browser.close();
