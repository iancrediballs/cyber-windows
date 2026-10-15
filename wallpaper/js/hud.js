/* NEON//OS — HUD: progression readout, clock, toasts, level-up cinematic, codex, GHOST companion, billboard copy. */
(function () {
  'use strict';
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /* ---------- progression ---------- */
  function renderProgress() {
    const { cur, next, pct } = CW.progress();
    $('lvl-num').textContent = 'LV ' + cur.lvl;
    $('lvl-title').textContent = cur.title;
    $('hp-fill').style.width = (pct * 100).toFixed(1) + '%';
    $('hp-val').textContent = CW.state.hp.toLocaleString() + ' HP';
    $('hp-next').textContent = next ? 'NEXT ' + next.hp.toLocaleString() : 'MAX';
    $('term-glyph').classList.toggle('hidden', !CW.hasLevel(4));
    $('ghost').classList.toggle('hidden', !CW.hasLevel(7));
    renderStatus();
  }

  function renderStatus() {
    const s = CW.state;
    const total = CW.EGGS ? Object.keys(CW.EGGS).length : 0;
    $('secrets').textContent = Object.keys(s.eggs).length + '/' + total;
    $('streak').textContent = s.days.streak + 'd';
    $('shards').textContent = s.stats.shards;
  }

  /* ---------- clock ---------- */
  function renderClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    const sep = d.getSeconds() % 2 ? ':' : ' ';
    $('clock').textContent = hh + sep + mm;
    $('date').textContent = `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear() + 50}`;
    $('weather').textContent = (CW.hasLevel(2) ? CW.world.weather : 'clear').toUpperCase();
  }

  /* ---------- toasts ---------- */
  function toast(kind, label, value) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = `<div class="t-k">${esc(label)}</div><div class="t-v">${esc(value)}</div>`;
    $('toasts').prepend(el);
    setTimeout(() => el.remove(), 5200);
    const all = $('toasts').children;
    while (all.length > 5) all[all.length - 1].remove();
  }

  function floatHp(x, y, amount) {
    const el = document.createElement('div');
    el.className = 'float-hp';
    el.textContent = '+' + amount + ' HP';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function overlay(text, ms) {
    const el = $('overlay-msg');
    el.classList.add('hidden');
    void el.offsetWidth; // restart animation
    el.textContent = text;
    el.style.animationDuration = (ms || 6000) + 'ms';
    el.classList.remove('hidden');
    clearTimeout(overlay._t);
    overlay._t = setTimeout(() => el.classList.add('hidden'), ms || 6000);
  }

  /* ---------- level-up ---------- */
  const luQueue = [];
  function showLevelUp(l) {
    if (luQueue.length > 1) luQueue.length = 1; // multi-level jumps: only show the newest
    luQueue.push(l);
    if (luQueue.length === 1) playNextLevelUp();
  }
  function playNextLevelUp() {
    const l = luQueue[0]; if (!l) return;
    const el = $('levelup');
    el.classList.add('hidden'); void el.offsetWidth;
    $('lu-title').textContent = l.title; $('lu-title').dataset.text = l.title;
    $('lu-unlock').textContent = 'UNLOCKED: ' + l.unlock;
    el.classList.remove('hidden');
    CW.sfx.levelup();
    CW.world.glitchSlice();
    setTimeout(() => { el.classList.add('hidden'); luQueue.shift(); playNextLevelUp(); }, 4500);
  }

  /* ---------- codex ---------- */
  function renderCodex() {
    const s = CW.state, lvl = CW.levelFor(s.hp).lvl;
    $('codex-levels').innerHTML = CW.LEVELS.map((l) =>
      `<li class="${l.lvl > lvl ? 'locked' : ''}"><b>LV${l.lvl} ${esc(l.title)}</b> — ${l.hp.toLocaleString()} HP<small>${esc(l.unlock)}</small></li>`).join('');
    $('codex-ach').innerHTML = Object.entries(CW.ACHIEVEMENTS).map(([id, a]) =>
      `<li class="${s.achievements[id] ? '' : 'locked'}"><b>${esc(a.name)}</b>${a.hp ? ' +' + a.hp : ''}<small>${esc(a.desc)}</small></li>`).join('');
    const hintsOn = CW.hasLevel(7);
    $('codex-eggs').innerHTML = Object.entries(CW.EGGS || {}).map(([id, e]) => {
      const found = s.eggs[id];
      const body = found ? `<b>${esc(e.name)}</b> +${e.hp}` : '<b>???</b>';
      const hint = found ? e.desc : (hintsOn ? 'GHOST: "' + e.hint + '"' : 'Reach LV7 for hints');
      return `<li class="${found ? '' : 'locked'}">${body}<small>${esc(hint)}</small></li>`;
    }).join('');
    const st = s.stats, lk = s.link;
    $('codex-stats').innerHTML = [
      ['Sessions', st.sessions], ['Minutes jacked in', st.minutes], ['City clicks', st.clicks],
      ['Drones hacked', st.drones], ['Breaches won', st.breaches], ['Apps discovered', lk.apps],
      ['Folders explored', lk.folders], ['Window switches', lk.switches], ['Online since', s.days.first],
    ].map(([k, v]) => `<li>${k} <b style="float:right">${esc(v)}</b></li>`).join('');
  }
  function toggleCodex(force) {
    const el = $('codex');
    const show = force === undefined ? el.classList.contains('hidden') : force;
    if (show) renderCodex();
    el.classList.toggle('hidden', !show);
  }

  /* ---------- GHOST companion (LV7) ---------- */
  let ghostTimer = null;
  function ghostSay(text, ms) {
    if (!CW.hasLevel(7)) return;
    const el = $('ghost-say');
    el.textContent = '';
    let i = 0;
    clearInterval(ghostTimer);
    ghostTimer = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(ghostTimer);
        setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, ms || 9000);
      }
    }, 28);
  }

  function ghostIdleChatter() {
    if (!CW.hasLevel(7) || Math.random() < 0.35) return;
    const s = CW.state;
    const unfound = Object.entries(CW.EGGS || {}).filter(([id]) => !s.eggs[id]);
    const h = new Date().getHours();
    const lines = [
      `Uptime streak: ${s.days.streak} days. The city remembers you.`,
      h < 5 ? 'Late shift, choom. The city is quieter. Some things only happen in the quiet.' : 'The grid hums. Every app you open is a new district.',
      CW.link && CW.link.online ? 'Neural Link stable. I can see where you roam.' : 'Neural Link offline. Run neural-link.ps1 and I can map your journey.',
      `You've hacked ${s.stats.drones} drones. Corporate insurance hates you.`,
    ];
    if (unfound.length) {
      const [, egg] = unfound[Math.floor(Math.random() * unfound.length)];
      lines.push('Rumor on the net: "' + egg.hint + '"', 'Rumor on the net: "' + egg.hint + '"');
    }
    ghostSay(lines[Math.floor(Math.random() * lines.length)]);
  }

  /* ---------- billboard copy (LV7) ---------- */
  const ADS = ['ARASHI CORP // WE OWN TOMORROW', 'SYNTHMEAT™ — TASTES LIKE NOSTALGIA', 'UPGRADE YOUR EYES', 'NO FUTURE // NO PROBLEM', 'OPTIC-FREE ZONE', 'DRINK NEUROCOLA'];
  let track = null;
  CW.setTrack = (t) => { track = t; };
  CW.billboardText = () => {
    const slot = Math.floor(Date.now() / 8000) % 4;
    if (slot === 0 && track) return '♪ NOW PLAYING: ' + track;
    if (slot === 1) return CW.levelFor(CW.state.hp).title + ' // ' + CW.state.hp + ' HP';
    return ADS[Math.floor(Date.now() / 32000) % ADS.length];
  };

  /* ---------- wiring ---------- */
  CW.bus.on('hp', (e) => {
    renderProgress();
    if (!e.quiet) toast('', e.reason, '+' + e.amount + ' HP');
  });
  CW.bus.on('levelup', (l) => {
    showLevelUp(l);
    CW.world.buildSkyline();
    const pal = Object.keys(CW.world.PALETTES).find((k) => CW.world.PALETTES[k].minLvl === l.lvl);
    if (pal) { CW.world.setPalette(pal); CW.state.palette = pal; CW.save(); }
    ghostSay('Level ' + l.lvl + '. ' + l.unlock + '. Keep moving.');
  });
  CW.bus.on('achievement', (a) => { toast('ach', 'ACHIEVEMENT UNLOCKED', a.name + ' — ' + a.desc); CW.sfx.secret(); });
  CW.bus.on('egg', (e) => { renderStatus(); ghostSay('You found one. "' + e.name + '." There are more.'); });
  CW.bus.on('reset', (e) => { renderProgress(); CW.world.buildSkyline(); if (!e.silent) toast('', 'SYSTEM', 'Save wiped. Welcome back, stranger.'); });

  $('id-panel').addEventListener('click', () => toggleCodex());
  document.querySelector('#codex [data-close]').addEventListener('click', () => toggleCodex(false));

  setInterval(renderClock, 1000);
  setInterval(ghostIdleChatter, 75000);

  CW.hud = { renderProgress, renderStatus, renderClock, toast, floatHp, overlay, toggleCodex, ghostSay };
})();
