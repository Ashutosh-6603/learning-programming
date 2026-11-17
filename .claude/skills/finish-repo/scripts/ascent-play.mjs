// Plays steps of one Ascent route in Chromium against YOUR OWN Ascent server (never port 5199).
// Usage: node ascent-play.mjs <questId> <linkedRepoPath> <outDir> <stepId>...
//   e.g. node ascent-play.mjs taskflow-fastapi /tmp/x/rebuild out 0.1 0.2 0.3 0.4 0.5
// Start the server first, with a throwaway save:
//   ASCENT_DATA_DIR=<tmp> node_modules/.bin/vite --port 5300 --strictPort   (from ascent/)
// Prints each step's tasks as label=checked, saves screenshots to outDir, and lists page errors.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = '/home/ashutosh/Projects/personal/learning-programming';
const { chromium } = require(`${ROOT}/taskflow/taskflow-frontend-node/node_modules/playwright`);

const [questId, linkedRepo, outDir, ...stepIds] = process.argv.slice(2);
if (!questId || !linkedRepo || !outDir || stepIds.length === 0) {
  console.error('usage: node ascent-play.mjs <questId> <linkedRepoPath> <outDir> <stepId>...');
  process.exit(2);
}
const base = process.env.ASCENT_URL ?? 'http://localhost:5300';
if (base.includes(':5199')) throw new Error('5199 may be the user’s game: use your own server');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}/`);
const peak = page.locator(`[aria-label^="${questId}:"]`);
await peak.waitFor();
console.log('home:', await peak.getAttribute('aria-label'));

await page.goto(`${base}/q/${questId}`);
await page.getByText('Briefing & repo link').click();
await page.fill(`#link-${questId}`, linkedRepo);
await page.locator(`#link-${questId}`).press('Enter');
await page.waitForTimeout(800);
console.log('route steps:', await page.locator('[aria-label^="Step "]').count());

for (const id of stepIds) {
  await page.goto(`${base}/q/${questId}/${id}`);
  await page.waitForSelector('[role=checkbox]');
  await page.waitForTimeout(2500); // let the git-log watcher tick a matching commit by itself
  for (let guard = 0; guard < 60; guard++) {
    const next = page.locator('[role=checkbox][aria-checked=false]:not([disabled])').first();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(150);
  }
  const boxes = await page
    .locator('[role=checkbox]')
    .evaluateAll((els) =>
      els.map((e) => `${e.getAttribute('aria-label')}=${e.getAttribute('aria-checked')}`),
    );
  console.log(id, boxes.join(' | '));
  await page.screenshot({ path: `${outDir}/step-${id}.png` });
}
await page.goto(`${base}/patches`);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/patches.png`, fullPage: true });
console.log('page errors:', errors);
await browser.close();
