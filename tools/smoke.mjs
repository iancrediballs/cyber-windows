// Headless smoke test for the NEON//OS wallpaper. Usage: node tools/smoke.mjs [outDir]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tools', 'out'));
fs.mkdirSync(out, { recursive: true });
const url = (q) => 'file://' + path.join(root, 'wallpaper', 'index.html') + q;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|localhost:47777/.test(m.text())) errors.push(m.text()); });

const check = (cond, msg) => { if (!cond) { errors.push('ASSERT: ' + msg); } else console.log('ok  ', msg); };

// LV1 fresh
await page.goto(url('?demo=0'));
await page.waitForTimeout(1500);
check(await page.evaluate(() => CW.levelFor(CW.state.hp).lvl) === 1, 'fresh save boots at LV1');
check(await page.evaluate(() => !!CW.state.achievements.FIRST_BOOT), 'FIRST_BOOT achievement granted');
await page.screenshot({ path: path.join(out, 'lv1.png') });

// Terminal locked at LV1
await page.keyboard.press('Backquote');
check(await page.evaluate(() => document.getElementById('terminal').classList.contains('hidden')), 'terminal locked below LV4');

// Konami egg
for (const k of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']) await page.keyboard.press(k);
check(await page.evaluate(() => !!CW.state.eggs.CHEAT_CODE), 'konami egg found');

// Typed egg
await page.keyboard.type('wakeup');
check(await page.evaluate(() => !!CW.state.eggs.WAKE_UP), 'wakeup egg found');

// Level up to max
await page.goto(url('?demo=12000'));
await page.waitForTimeout(6000);
check(await page.evaluate(() => CW.levelFor(CW.state.hp).lvl) === 10, 'demo=12000 reaches LV10');
await page.evaluate(() => { CW.world.weather = 'storm'; CW.world.setPalette('NEON'); });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(out, 'lv10.png') });

// Terminal
await page.keyboard.press('Backquote');
check(await page.evaluate(() => !document.getElementById('terminal').classList.contains('hidden')), 'terminal opens at LV10');
for (const c of ['help', 'status', 'palette ARASHI', 'echo hello world', 'sudo rm -rf /', 'cat /dev/dreams', 'constructor', '__proto__']) {
  await page.fill('#term-input', c); await page.press('#term-input', 'Enter');
}
check(await page.evaluate(() => CW.world.paletteName === 'ARASHI'), 'palette command switches palette');
check(await page.evaluate(() => ['FIRST_PROGRAM','NICE_TRY','DEEP_DIVE'].every((k) => CW.state.eggs[k])), 'terminal eggs found');
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(out, 'terminal.png') });
await page.keyboard.press('Escape');

// Breach: solve by brute force over the legal move tree
await page.evaluate(() => CW.breach.open());
const solved = await page.evaluate(() => {
  const cells = () => [...document.querySelectorAll('#breach-grid .cell')];
  const target = [...document.querySelectorAll('#breach-target .slot')].map((e) => e.textContent);
  const grid = []; cells().forEach((c, i) => { (grid[Math.floor(i / 5)] = grid[Math.floor(i / 5)] || []).push(c.textContent); });
  function dfs(buf, used, horiz, line) {
    if (buf.join(' ').includes(target.join(' '))) return [];
    if (buf.length >= 6) return null;
    for (let k = 0; k < 5; k++) {
      const r = horiz ? line : k, c = horiz ? k : line, id = r * 5 + c;
      if (used.has(id)) continue;
      const res = dfs([...buf, grid[r][c]], new Set([...used, id]), !horiz, horiz ? c : r);
      if (res) return [[r, c], ...res];
    }
    return null;
  }
  const path = dfs([], new Set(), true, 0);
  if (!path) return false;
  for (const [r, c] of path) cells()[r * 5 + c].click();
  return CW.state.stats.breaches === 1;
});
check(solved, 'breach protocol is solvable and pays out');
await page.screenshot({ path: path.join(out, 'breach.png') });

// Codex
await page.evaluate(() => { CW.breach.close(); CW.hud.toggleCodex(true); });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'codex.png') });

// Neural Link ingest
await page.evaluate(() => CW.hud.toggleCodex(false));
const before = await page.evaluate(() => CW.state.hp);
await page.route('http://localhost:47777/state', (r) => r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ v: 1, totals: { switches: 10, launches: 2, apps: 3, folders: 4 }, activity: 0.7, events: [{ seq: 1, type: 'app', name: 'code' }] }) }));
await page.waitForTimeout(4500);
const after = await page.evaluate(() => CW.state.hp);
check(await page.evaluate(() => CW.link.online), 'neural link goes online against mocked daemon');
check(after - before >= 10 + 6 + 75 + 32, `neural link awards HP for activity (+${after - before})`);

await browser.close();
if (errors.length) { console.error('FAIL\n' + errors.join('\n')); process.exit(1); }
console.log('PASS → screenshots in ' + out);

// Windows PowerShell 5.1 reads BOM-less scripts as ANSI; non-ASCII (e.g. em-dash) can become a smart
// quote that terminates strings. Keep every .ps1 pure ASCII.
for (const f of ['installer/install.ps1', 'installer/uninstall.ps1', 'daemon/neural-link.ps1']) {
  const txt = fs.readFileSync(path.join(root, f), 'utf8').replace(/^﻿/, '');
  if (/[^\x00-\x7F]/.test(txt)) { console.error('FAIL non-ASCII in ' + f); process.exit(1); }
}
console.log('ok   PowerShell scripts are ASCII-only');
