/* NEON//OS — Breach Protocol minigame (LV5). Alternate row/column picks to assemble the daemon sequence. */
(function () {
  'use strict';
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const CODES = ['1C', '55', 'BD', 'E9', '7A', 'FF'];
  const N = 5, BUFFER = 6, TIME = 30;

  let g = null; // game state

  function rand(a) { return a[Math.floor(Math.random() * a.length)]; }

  function newGame() {
    const grid = Array.from({ length: N }, () => Array.from({ length: N }, () => rand(CODES)));
    // Build a guaranteed-solvable target by walking a legal path through the grid.
    const len = 3 + (CW.hasLevel(8) ? 1 : 0);
    const path = []; const used = new Set();
    let row = 0, col = -1, horizontal = true;
    // first pick is in row 0; make the target start somewhere after 0-1 filler picks
    const filler = Math.random() < 0.5 ? 1 : 0;
    for (let i = 0; i < len + filler; i++) {
      let r, c, tries = 0;
      do {
        if (horizontal) { r = row; c = Math.floor(Math.random() * N); } else { c = col; r = Math.floor(Math.random() * N); }
        tries++;
      } while (used.has(r * N + c) && tries < 50);
      used.add(r * N + c); path.push([r, c]); row = r; col = c; horizontal = !horizontal;
    }
    const target = path.slice(filler).map(([r, c]) => grid[r][c]);
    g = { grid, target, buffer: [], used: new Set(), horizontal: true, line: 0, timeLeft: TIME, running: true, started: false };
    render();
  }

  function isActive(r, c) {
    if (!g.running || g.used.has(r * N + c)) return false;
    return g.horizontal ? r === g.line : c === g.line;
  }

  function matched() {
    // does the buffer contain the target as a contiguous subsequence?
    const b = g.buffer.join(' '), t = g.target.join(' ');
    return b.includes(t);
  }
  function progressLen() {
    // longest suffix of buffer that is a prefix of target (for highlighting)
    for (let k = Math.min(g.target.length, g.buffer.length); k > 0; k--) {
      if (g.buffer.slice(-k).join() === g.target.slice(0, k).join()) return k;
    }
    return 0;
  }

  function pick(r, c) {
    if (!isActive(r, c)) return;
    g.started = true;
    g.used.add(r * N + c);
    g.buffer.push(g.grid[r][c]);
    g.horizontal = !g.horizontal;
    g.line = g.horizontal ? r : c;
    CW.sfx.blip();
    if (matched()) return end(true);
    if (g.buffer.length >= BUFFER) return end(false, 'BUFFER OVERFLOW');
    render();
  }

  function end(win, why) {
    g.running = false;
    if (win) {
      CW.state.stats.breaches++;
      CW.save();
      CW.sfx.hack();
      const bonus = Math.round(g.timeLeft * 2);
      CW.award(60 + bonus, 'BREACH SUCCESSFUL');
      CW.unlockAchievement('BREACH_1');
      if (CW.state.stats.breaches >= 10) CW.unlockAchievement('BREACH_10');
      $('breach-status').innerHTML = '<span style="color:#39ff14">DAEMON UPLOADED.</span> Click to run another.';
    } else {
      CW.sfx.error();
      $('breach-status').innerHTML = '<span style="color:#ff3b5c">' + (why || 'BREACH FAILED') + '.</span> Click to retry.';
    }
    render(true);
  }

  function render(keepStatus) {
    const grid = $('breach-grid');
    grid.innerHTML = '';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const el = document.createElement('div');
      el.className = 'cell' + (g.used.has(r * N + c) ? ' used' : '') + (isActive(r, c) ? ' active' : '');
      el.textContent = g.used.has(r * N + c) ? '[ ]' : g.grid[r][c];
      el.addEventListener('click', () => (g.running ? pick(r, c) : newGame()));
      grid.appendChild(el);
    }
    $('breach-buffer').innerHTML = Array.from({ length: BUFFER }, (_, i) =>
      `<div class="slot ${g.buffer[i] ? 'fill' : ''}">${g.buffer[i] || ''}</div>`).join('');
    const p = progressLen();
    $('breach-target').innerHTML = g.target.map((t, i) => `<div class="slot ${i < p ? 'hit' : ''}">${t}</div>`).join('');
    if (!keepStatus && g.running) $('breach-status').textContent = 'Pick from the highlighted ' + (g.horizontal ? 'ROW' : 'COLUMN') + '. Timer starts on first pick.';
    $('breach-timer').textContent = g.timeLeft.toFixed(1);
  }

  function tick(dt) {
    if (!g || !g.running || !g.started || $('breach').classList.contains('hidden')) return;
    g.timeLeft = Math.max(0, g.timeLeft - dt);
    $('breach-timer').textContent = g.timeLeft.toFixed(1);
    if (g.timeLeft <= 0) end(false, 'ICE TRACED YOU');
  }

  function open() {
    if (!CW.hasLevel(5)) return false;
    $('breach').classList.remove('hidden');
    newGame();
    return true;
  }
  function close() { $('breach').classList.add('hidden'); if (g) g.running = false; }

  document.querySelector('#breach [data-close]').addEventListener('click', close);
  CW.breach = { open, close, tick };
})();
