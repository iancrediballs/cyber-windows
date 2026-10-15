// Renders static assets from the live wallpaper: assets/wallpaper.png (4K, no HUD) + wallpaper/thumbnail.jpg.
// Usage: node tools/render-assets.mjs [--check-link=PORT]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const page0 = 'file://' + path.join(root, 'wallpaper', 'index.html');
const linkArg = process.argv.find((a) => a.startsWith('--check-link='));
const browser = await chromium.launch();

if (linkArg) {
  const port = linkArg.split('=')[1];
  const p = await browser.newPage();
  await p.goto(`${page0}?demo=0&port=${port}`);
  await p.waitForTimeout(3500);
  const online = await p.evaluate(() => CW.link.online);
  console.log(online ? `link OK: file:// page reached daemon on :${port}` : 'link FAILED');
  await browser.close();
  process.exit(online ? 0 : 1);
}

async function shot(q, file, opts) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: opts.dpr || 1 });
  await p.goto(page0 + q);
  await p.evaluate((pal) => { CW.world.weather = 'rain'; CW.world.setPalette(pal); }, opts.palette || 'NEON');
  await p.waitForTimeout(3000);
  await p.evaluate(() => { document.getElementById('levelup').classList.add('hidden'); document.getElementById('toasts').innerHTML = ''; });
  await p.screenshot({ path: path.join(root, file), type: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 85 : undefined });
  await p.close();
  console.log('wrote', file);
}

await shot('?demo=8000&nohud', 'assets/wallpaper.png', { dpr: 2 });
await shot('?demo=3300', 'wallpaper/thumbnail.jpg', { dpr: 0.5 });
await shot('?demo=3300', 'assets/preview.jpg', { dpr: 1 });
await browser.close();
