/* NEON//OS — in-world terminal (LV4). */
(function () {
  'use strict';
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const out = $('term-out'), input = $('term-input');
  const history = []; let hIdx = 0;

  function print(text, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  const COMMANDS = {
    help: { desc: 'list commands', run() {
      Object.entries(COMMANDS).filter(([, c]) => !c.hidden && CW.hasLevel(c.lvl || 1))
        .forEach(([k, c]) => print(k.padEnd(12) + c.desc, 'dim'));
    } },
    status: { desc: 'operator status', run() {
      const { cur, next } = CW.progress();
      print(`LV${cur.lvl} ${cur.title}  ${CW.state.hp} HP` + (next ? `  (${next.hp - CW.state.hp} to ${next.title})` : '  MAX'), 'hi');
      print(`secrets ${Object.keys(CW.state.eggs).length}/${Object.keys(CW.EGGS).length} · achievements ${Object.keys(CW.state.achievements).length}/${Object.keys(CW.ACHIEVEMENTS).length} · streak ${CW.state.days.streak}d`);
    } },
    codex: { desc: 'open the codex', run() { close(); CW.hud.toggleCodex(true); } },
    whoami: { desc: 'identify', run() { print('netrunner. unregistered. uninsured. unstoppable.'); } },
    date: { desc: 'local time', run() { print(new Date().toString()); } },
    clear: { desc: 'clear screen', run() { out.innerHTML = ''; } },
    exit: { desc: 'close terminal', run() { close(); } },
    echo: { desc: 'echo <text>', run(args) {
      const t = args.join(' ');
      print(t);
      if (/^hello,? world!?$/i.test(t.trim())) CW.eggs.find('FIRST_PROGRAM');
    } },
    weather: { desc: 'weather <clear|rain|fog|storm>', lvl: 2, run(args) {
      const w = (args[0] || '').toLowerCase();
      if (!['clear', 'rain', 'fog', 'storm'].includes(w)) return print('usage: weather <clear|rain|fog|storm>', 'err');
      CW.world.weather = w; print('atmospheric override: ' + w, 'ok');
    } },
    palette: { desc: 'palette [name] — switch city colors', run(args) {
      const lvl = CW.levelFor(CW.state.hp).lvl;
      const avail = Object.entries(CW.world.PALETTES).filter(([, p]) => p.minLvl <= lvl).map(([k]) => k);
      if (!args[0]) return print('available: ' + avail.join(', ') + '   current: ' + CW.world.paletteName);
      const name = args[0].toUpperCase();
      if (!avail.includes(name)) return print('palette locked or unknown: ' + name, 'err');
      CW.world.setPalette(name); CW.state.palette = name; CW.save(); print('palette → ' + name, 'ok');
    } },
    scan: { desc: 'scan the city for anomalies', run() {
      CW.world.spawnShard();
      print('scanning…', 'dim');
      print('data shard materialized somewhere above the skyline. grab it.', 'ok');
      const unfound = Object.entries(CW.EGGS).filter(([id]) => !CW.state.eggs[id]);
      if (unfound.length && CW.hasLevel(6)) print('intercepted chatter: "' + unfound[Math.floor(Math.random() * unfound.length)][1].hint + '"', 'hi');
    } },
    breach: { desc: 'run Breach Protocol (LV5)', lvl: 5, run() {
      if (!CW.breach.open()) return print('access denied: requires LV5 ICE_BREAKER', 'err');
      close();
    } },
    link: { desc: 'Neural Link daemon status', run() {
      const l = CW.link;
      print(l.online ? `ONLINE @ ${l.url}` : `OFFLINE — start daemon/neural-link.ps1 (expects ${l.url})`, l.online ? 'ok' : 'err');
      const s = CW.state.link;
      print(`apps ${s.apps} · folders ${s.folders} · switches ${s.switches} · launches ${s.launches}`, 'dim');
    } },
    ghost: { desc: 'talk to GHOST (LV7)', lvl: 7, run(args) {
      const q = args.join(' ').toLowerCase();
      const reply = !q ? 'Ask me something, choom.'
        : /hint|secret|egg/.test(q) ? (() => { const u = Object.entries(CW.EGGS).filter(([id]) => !CW.state.eggs[id]); return u.length ? u[Math.floor(Math.random() * u.length)][1].hint : 'You found them all. Nothing is hidden anymore.'; })()
        : /who/.test(q) ? 'A ghost in your shell. I live in the wallpaper.'
        : /love/.test(q) ? 'Error 418: I am a teapot. But… thanks.'
        : 'The city hears you. It does not answer in words.';
      print('GHOST> ' + reply, 'hi'); CW.hud.ghostSay(reply);
    } },
    matrix: { desc: 'toggle data rain (LV6)', lvl: 6, run() { print('you are already in it.', 'hi'); } },
    reset: { desc: 'reset --confirm  (wipe save)', run(args) {
      if (args[0] !== '--confirm') return print('this wipes all HP/levels/secrets. run: reset --confirm', 'err');
      CW.reset(); print('save wiped.', 'ok');
    } },
    sudo: { hidden: true, run(args) {
      if (args.join(' ').replace(/\s+/g, ' ').trim() === 'rm -rf /') {
        print('Nice try, choom. The city deletes YOU.', 'err');
        CW.world.blackout = 1.5;
        CW.eggs.find('NICE_TRY');
      } else print('operator is not in the sudoers file. This incident will be reported to Arashi Corp.', 'err');
    } },
    cat: { hidden: true, run(args) {
      if (args[0] === '/dev/dreams') {
        ['…neon koi swimming through server racks…', '…a city that never logged off…', '…you, but chrome…'].forEach((l) => print(l, 'hi'));
        CW.eggs.find('DEEP_DIVE');
      } else print('cat: ' + (args[0] || '') + ': permission denied', 'err');
    } },
    ls: { hidden: true, run() { print('/dev  /home/netrunner  /var/log/sins  README.nfo'); } },
  };

  function exec(line) {
    print('> ' + line, 'dim');
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return;
    const key = cmd.toLowerCase();
    const c = Object.prototype.hasOwnProperty.call(COMMANDS, key) ? COMMANDS[key] : null;
    if (!c || !CW.hasLevel(c.lvl || 1)) { CW.sfx.error(); return print(`command not found: ${cmd}. try 'help'`, 'err'); }
    if (!CW.state.seenCommands[key]) { CW.state.seenCommands[key] = 1; CW.save(); CW.award(5, 'NEW COMMAND: ' + key, { quiet: true }); }
    c.run(args);
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const v = input.value; history.push(v); hIdx = history.length; input.value = ''; exec(v); }
    else if (e.key === 'ArrowUp') { hIdx = Math.max(0, hIdx - 1); input.value = history[hIdx] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] || ''; }
    else if (e.key === 'Escape' || e.key === '`') { e.preventDefault(); close(); }
  });

  function open() {
    if (!CW.hasLevel(4)) return false;
    const el = $('terminal');
    el.classList.remove('hidden');
    if (!out.childElementCount) {
      print('NEON//OS kernel 2077.10 — netrunner shell', 'hi');
      print("type 'help'. some commands are not listed.", 'dim');
    }
    CW.unlockAchievement('TERMINAL_1');
    setTimeout(() => input.focus(), 0);
    return true;
  }
  function close() { $('terminal').classList.add('hidden'); input.blur(); }
  function toggle() { return $('terminal').classList.contains('hidden') ? open() : (close(), true); }

  document.querySelector('#terminal [data-close]').addEventListener('click', close);
  $('term-glyph').addEventListener('click', () => toggle());
  CW.terminal = { open, close, toggle, exec };
})();
