/* NEON//OS — progression core: HP (Hack Points), levels, achievements, persistence, event bus. */
(function () {
  'use strict';

  // ?demo uses a throwaway slot so previews never touch the real save.
  const SAVE_KEY = /[?&]demo\b/.test(location.search) ? 'neonos.demo' : 'neonos.save.v1';

  const LEVELS = [
    { lvl: 1,  hp: 0,     title: 'BOOT_SEQUENCE', unlock: 'Neon skyline, horizon grid, HUD' },
    { lvl: 2,  hp: 100,   title: 'STREET_RAT',    unlock: 'Weather system: acid rain & fog' },
    { lvl: 3,  hp: 300,   title: 'GLITCH_RUNNER', unlock: 'Air traffic — click drones to hack them' },
    { lvl: 4,  hp: 650,   title: 'NETRUNNER',     unlock: 'Terminal (press ` or click the >_ glyph)' },
    { lvl: 5,  hp: 1200,  title: 'ICE_BREAKER',   unlock: 'Breach Protocol minigame + ARASHI palette' },
    { lvl: 6,  hp: 2000,  title: 'DATA_GHOST',    unlock: 'Audio-reactive skyline & data streams' },
    { lvl: 7,  hp: 3200,  title: 'CHROME_SAINT',  unlock: 'Holo-billboard + GHOST companion AI' },
    { lvl: 8,  hp: 5000,  title: 'SYNTH_ORACLE',  unlock: 'Lightning storms + TOXIC palette' },
    { lvl: 9,  hp: 7500,  title: 'VOID_WALKER',   unlock: 'Orbital megastructure in the sky' },
    { lvl: 10, hp: 11000, title: 'LEGEND',        unlock: 'AFTERLIFE gold palette + full city' },
  ];

  const ACHIEVEMENTS = {
    FIRST_BOOT:     { name: 'Jacked In',          desc: 'Boot NEON//OS for the first time', hp: 25 },
    STREAK_3:       { name: 'Regular',            desc: 'Return 3 days in a row', hp: 60 },
    STREAK_7:       { name: 'Local Legend',       desc: 'Return 7 days in a row', hp: 200 },
    CLICKS_100:     { name: 'Twitchy Fingers',    desc: 'Click the city 100 times', hp: 40 },
    SHARDS_10:      { name: 'Data Hoarder',       desc: 'Collect 10 data shards', hp: 80 },
    DRONES_25:      { name: 'Skyjacker',          desc: 'Hack 25 drones', hp: 100 },
    BREACH_1:       { name: 'Breach Protocol',    desc: 'Win a breach', hp: 75 },
    BREACH_10:      { name: 'Daemon Lord',        desc: 'Win 10 breaches', hp: 250 },
    TERMINAL_1:     { name: 'Hello, Operator',    desc: 'Open the terminal', hp: 20 },
    APPS_10:        { name: 'Tourist',            desc: 'Discover 10 different apps (Neural Link)', hp: 80 },
    APPS_40:        { name: 'Cartel Connections', desc: 'Discover 40 different apps (Neural Link)', hp: 250 },
    FOLDERS_25:     { name: 'Cartographer',       desc: 'Explore 25 distinct folders (Neural Link)', hp: 100 },
    FOLDERS_150:    { name: 'Deep Diver',         desc: 'Explore 150 distinct folders (Neural Link)', hp: 300 },
    SWITCH_500:     { name: 'Multithreaded',      desc: '500 window switches (Neural Link)', hp: 150 },
    LINK_ONLINE:    { name: 'Neural Link',        desc: 'Connect the Neural Link daemon', hp: 50 },
    SECRETS_HALF:   { name: 'Conspiracy Theorist',desc: 'Find half the secrets', hp: 200 },
    SECRETS_ALL:    { name: 'Nothing Is Hidden',  desc: 'Find every secret', hp: 1000 },
    LEGEND:         { name: 'Legend of Neon City',desc: 'Reach level 10', hp: 0 },
  };

  /* ---------- event bus ---------- */
  const listeners = {};
  const bus = {
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(evt, e); } }); },
  };

  /* ---------- persistence ---------- */
  const today = () => new Date().toISOString().slice(0, 10);

  function freshState() {
    return {
      hp: 0,
      achievements: {},
      eggs: {},
      seenCommands: {},
      palette: 'NEON',
      stats: { clicks: 0, shards: 0, drones: 0, breaches: 0, sessions: 0, minutes: 0 },
      days: { first: today(), last: null, streak: 0 },
      link: { switches: 0, launches: 0, apps: 0, folders: 0 },
      hourly: { stamp: 0, clickHp: 0 },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return freshState();
      const base = freshState();
      const parsed = JSON.parse(raw);
      return Object.assign(base, parsed, {
        stats: Object.assign(base.stats, parsed.stats),
        days: Object.assign(base.days, parsed.days),
        link: Object.assign(base.link, parsed.link),
        hourly: Object.assign(base.hourly, parsed.hourly),
      });
    } catch (e) {
      console.warn('save corrupt, resetting', e);
      return freshState();
    }
  }

  let state = load();
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: session-only */ }
    }, 250);
  }

  /* ---------- levels ---------- */
  function levelFor(hp) {
    let cur = LEVELS[0];
    for (const l of LEVELS) if (hp >= l.hp) cur = l;
    return cur;
  }
  function progress() {
    const cur = levelFor(state.hp);
    const next = LEVELS[cur.lvl] || null;
    const pct = next ? (state.hp - cur.hp) / (next.hp - cur.hp) : 1;
    return { cur, next, pct: Math.max(0, Math.min(1, pct)) };
  }

  /* ---------- HP ---------- */
  function award(amount, reason, opts) {
    if (!amount || amount <= 0) return;
    const before = levelFor(state.hp).lvl;
    state.hp += Math.round(amount);
    const after = levelFor(state.hp).lvl;
    save();
    bus.emit('hp', { amount: Math.round(amount), reason, total: state.hp, quiet: opts && opts.quiet });
    for (let l = before + 1; l <= after; l++) bus.emit('levelup', LEVELS[l - 1]);
    if (after >= 10) unlockAchievement('LEGEND');
  }

  /* Rate-limited ambient HP (clicks) so the economy can't be farmed by autoclicking. */
  function awardCapped(amount, reason, capPerHour) {
    const hour = Math.floor(Date.now() / 3600000);
    if (state.hourly.stamp !== hour) { state.hourly.stamp = hour; state.hourly.clickHp = 0; }
    if (state.hourly.clickHp >= capPerHour) return;
    state.hourly.clickHp += amount;
    award(amount, reason, { quiet: true });
  }

  function unlockAchievement(id) {
    const a = ACHIEVEMENTS[id];
    if (!a || state.achievements[id]) return false;
    state.achievements[id] = Date.now();
    save();
    bus.emit('achievement', Object.assign({ id }, a));
    if (a.hp) award(a.hp, 'ACHIEVEMENT: ' + a.name, { quiet: true });
    return true;
  }

  function hasLevel(n) { return levelFor(state.hp).lvl >= n; }

  /* ---------- daily boot / streak ---------- */
  function boot() {
    state.stats.sessions++;
    const t = today();
    if (state.days.last !== t) {
      const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      state.days.streak = state.days.last === y ? state.days.streak + 1 : 1;
      state.days.last = t;
      save();
      award(10 + 5 * Math.min(state.days.streak, 10), 'DAILY UPLINK x' + state.days.streak);
      if (state.days.streak >= 3) unlockAchievement('STREAK_3');
      if (state.days.streak >= 7) unlockAchievement('STREAK_7');
    }
    unlockAchievement('FIRST_BOOT');
    save();
  }

  function reset(silent) {
    state = freshState();
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    bus.emit('reset', { silent: !!silent });
  }

  window.CW = window.CW || {};
  Object.assign(window.CW, {
    LEVELS, ACHIEVEMENTS, bus, award, awardCapped, unlockAchievement, hasLevel, progress, levelFor, boot, reset, save,
  });
  // live getter: reset() swaps the object, so consumers must never hold a stale reference
  Object.defineProperty(window.CW, 'state', { get: () => state, enumerable: true });
})();
