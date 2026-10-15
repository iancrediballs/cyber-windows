/* NEON//OS — boot, input routing, main loop. */
(function () {
  'use strict';
  const CW = window.CW;

  CW.fpsCap = 60;
  CW.input = { mx: 0, my: 0, lastActive: Date.now() };

  /* ---------- boot ---------- */
  const q = new URLSearchParams(location.search);
  if (q.has('port')) CW.linkSetPort(q.get('port'));
  if (q.has('demo')) CW.reset(true);
  if (q.has('nohud')) document.getElementById('hud').classList.add('off'); // ?demo=5000 → fresh throwaway save at a given HP (see state.js SAVE_KEY)

  CW.world.resize();
  const saved = CW.state.palette;
  CW.world.setPalette(CW.world.PALETTES[saved] && CW.world.PALETTES[saved].minLvl <= CW.levelFor(CW.state.hp).lvl ? saved : 'NEON');
  CW.world.rollWeather();
  CW.hud.renderProgress();
  CW.hud.renderClock();
  CW.boot();
  if (q.has('demo')) CW.award(Number(q.get('demo')) || 0, 'DEMO MODE', { quiet: true });
  CW.eggs.onMinute();
  CW.linkStart();

  /* ---------- input ---------- */
  const isUi = (el) => el.closest && el.closest('#codex, #terminal, #breach, #id-panel, #term-glyph, #clock-panel, #status-panel, #ghost');
  const touch = () => { CW.input.lastActive = Date.now(); CW.world.intensity = Math.min(1, CW.world.intensity + 0.02); };

  window.addEventListener('resize', () => CW.world.resize());

  window.addEventListener('pointermove', (e) => {
    CW.input.mx = e.clientX; CW.input.my = e.clientY;
    touch();
    CW.eggs.onMove(e.clientX, e.clientY);
  });

  window.addEventListener('pointerdown', (e) => {
    touch();
    if (isUi(e.target)) return;
    CW.eggs.onHoldStart(CW.world.hitTest(e.clientX, e.clientY));
  });
  window.addEventListener('pointerup', () => CW.eggs.onHoldEnd());

  window.addEventListener('click', (e) => {
    if (isUi(e.target)) return;
    const hit = CW.world.hitTest(e.clientX, e.clientY);
    const s = CW.state;
    if (hit.type === 'shard') {
      s.stats.shards++;
      CW.sfx.pickup();
      CW.award(15, 'DATA SHARD', { quiet: true });
      CW.hud.floatHp(e.clientX, e.clientY, 15);
      if (s.stats.shards >= 10) CW.unlockAchievement('SHARDS_10');
    } else if (hit.type === 'drone') {
      s.stats.drones++;
      CW.sfx.hack();
      CW.award(3, 'DRONE HACKED', { quiet: true });
      CW.hud.floatHp(e.clientX, e.clientY, 3);
      if (s.stats.drones >= 25) CW.unlockAchievement('DRONES_25');
    } else if (!CW.eggs.onHit(hit)) {
      s.stats.clicks++;
      CW.awardCapped(1, 'CITY PULSE', 60);
      if (s.stats.clicks >= 100) CW.unlockAchievement('CLICKS_100');
    }
    CW.save();
    CW.hud.renderStatus();
  });

  document.getElementById('clock').addEventListener('click', () => CW.eggs.onClockClick());

  window.addEventListener('keydown', (e) => {
    touch();
    if (e.target && e.target.id === 'term-input') return;
    if (e.key === '`' || e.key === '~') { e.preventDefault(); CW.terminal.toggle(); return; }
    if (e.key === 'Tab') { e.preventDefault(); CW.hud.toggleCodex(); return; }
    if (e.key === 'Escape') { CW.hud.toggleCodex(false); CW.terminal.close(); CW.breach.close(); return; }
    CW.eggs.onKey(e);
  });

  /* ---------- timers ---------- */
  setInterval(() => {
    CW.state.stats.minutes++;
    if (CW.state.stats.minutes % 5 === 0) CW.award(2, 'UPTIME', { quiet: true });
    CW.eggs.onMinute();
    if (new Date().getMinutes() === 0) CW.world.rollWeather();
    CW.save();
  }, 60000);

  /* ---------- loop ---------- */
  let last = performance.now(), acc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const minDt = 1000 / CW.fpsCap;
    acc += now - last; last = now;
    if (acc < minDt - 1) return;
    const dt = Math.min(acc / 1000, 0.1);
    acc = 0;
    CW.world.intensity = Math.max(0.15, CW.world.intensity - dt * 0.01);
    const idle = Date.now() - CW.input.lastActive;
    CW.eggs.onIdle(idle);
    document.getElementById('sync-fill').style.width = (CW.world.intensity * 100).toFixed(0) + '%';
    CW.world.frame(dt);
    CW.breach.tick(dt);
  }
  requestAnimationFrame(loop);
})();
