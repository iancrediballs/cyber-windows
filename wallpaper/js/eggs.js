/* NEON//OS — hidden easter eggs. Each is found once; each pays HP. */
(function () {
  'use strict';
  const CW = window.CW;

  const EGGS = {
    CHEAT_CODE:     { name: 'Cheat Code',       hp: 100, hint: 'Old soldiers remember: up, up, down, down…',               desc: 'Konami code — rainbow overdrive' },
    WAKE_UP:        { name: 'Wake Up',          hp: 80,  hint: 'Some words, typed into the void, rouse the samurai.',     desc: 'Typed "wakeup" on the desktop' },
    LUNAR_LENS:     { name: 'Lunar Lens',       hp: 60,  hint: 'The moon has been watching. Knock seven times.',          desc: 'Clicked the moon 7 times' },
    SIGNAL:         { name: 'The Signal',       hp: 90,  hint: 'One window blinks a word. Dots and dashes. Answer it.',   desc: 'Found the morse window that blinks R-U-N' },
    PERIMETER:      { name: 'Perimeter Sweep',  hp: 70,  hint: 'Walk the edges of your world, clockwise, from the top-left.', desc: 'Touched all four corners clockwise' },
    GHOST_HOUR:     { name: 'Ghost Hour',       hp: 120, hint: 'At thirty-three past the third hour, the city exhales.',  desc: 'Jacked in at 3:33' },
    ELECTRIC_SHEEP: { name: 'Electric Sheep',   hp: 50,  hint: 'Leave the city alone long enough and it starts to dream.', desc: 'Idled for 5 minutes' },
    NICE_TRY:       { name: 'Nice Try',         hp: 40,  hint: 'Every netrunner tries to delete the root once.',          desc: 'sudo rm -rf / in the terminal' },
    NOT_FOUND:      { name: 'Not Found',        hp: 40,  hint: 'Type the number of a page that does not exist.',          desc: 'Typed 404 on the desktop' },
    TIME_THIEF:     { name: 'Time Thief',       hp: 60,  hint: 'Tap the clock fast enough and time slips.',               desc: 'Clicked the clock 5 times quickly' },
    SOLAR_FLARE:    { name: 'Solar Flare',      hp: 50,  hint: 'Hold the sun. Do not let go.',                            desc: 'Held the sun for 3 seconds' },
    FIRST_PROGRAM:  { name: 'First Program',    hp: 30,  hint: 'Every coder starts by greeting the world.',               desc: 'echo hello world' },
    GRAFFITI:       { name: 'Graffiti',         hp: 60,  hint: 'Corporate billboards are just canvases. Tag it thrice.',  desc: 'Tagged the billboard' },
    CALENDAR_GLITCH:{ name: 'Calendar Glitch',  hp: 100, hint: 'Some dates are thin. Halloween. New Year. Friday the 13th.', desc: 'Visited on a cursed/celebrated date' },
    DEEP_DIVE:      { name: 'Deep Dive',        hp: 40,  hint: 'There is a device that stores what the city dreams.',     desc: 'cat /dev/dreams' },
  };

  function find(id) {
    const s = CW.state;
    if (!EGGS[id] || s.eggs[id]) return false;
    s.eggs[id] = Date.now();
    CW.save();
    CW.sfx.secret();
    CW.bus.emit('egg', Object.assign({ id }, EGGS[id]));
    CW.award(EGGS[id].hp, 'SECRET FOUND: ' + EGGS[id].name);
    const n = Object.keys(s.eggs).length, total = Object.keys(EGGS).length;
    if (n >= Math.ceil(total / 2)) CW.unlockAchievement('SECRETS_HALF');
    if (n >= total) CW.unlockAchievement('SECRETS_ALL');
    return true;
  }

  /* ---------- keyboard ---------- */
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiIdx = 0;
  let typed = '';

  function onKey(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiIdx = (k === KONAMI[konamiIdx]) ? konamiIdx + 1 : (k === KONAMI[0] ? 1 : 0);
    if (konamiIdx === KONAMI.length) {
      konamiIdx = 0;
      CW.world.rainbow = 30;
      CW.hud.overlay('CHEAT MODE: RAINBOW OVERDRIVE\n30 SECONDS', 4000);
      find('CHEAT_CODE');
    }
    if (k.length === 1) {
      typed = (typed + k).slice(-24);
      if (/wake ?up$/.test(typed)) {
        CW.hud.overlay('Wake up, samurai.\nWe have a city to burn.', 6000);
        CW.world.glitchSlice();
        find('WAKE_UP');
      }
      if (typed.endsWith('404')) {
        CW.world.blackout = 3;
        find('NOT_FOUND');
      }
    }
  }

  /* ---------- clicks ---------- */
  const counters = { moon: [], clock: [], billboard: [] };
  function burst(name, windowMs, needed) {
    const now = Date.now();
    counters[name] = counters[name].filter((t) => now - t < windowMs);
    counters[name].push(now);
    return counters[name].length >= needed;
  }

  function onHit(hit) {
    switch (hit.type) {
      case 'moon':
        CW.sfx.blip();
        if (burst('moon', 6000, 7)) { CW.world.moonCracked = true; CW.hud.overlay('THE MOON BLINKS BACK.', 3500); find('LUNAR_LENS'); }
        return true;
      case 'signal':
        CW.hud.overlay('· — ·   · · —   — ·\nR U N', 4000);
        find('SIGNAL');
        return true;
      case 'billboard':
        if (burst('billboard', 3000, 3)) {
          CW.setTrack && CW.setTrack(null);
          const old = CW.billboardText;
          CW.billboardText = () => 'NETRUNNER WAS HERE ☠ ' + CW.levelFor(CW.state.hp).title;
          setTimeout(() => { CW.billboardText = old; }, 20000);
          find('GRAFFITI');
        }
        return true;
      default:
        return false;
    }
  }

  function onClockClick() {
    CW.sfx.blip();
    if (burst('clock', 2000, 5)) {
      CW.world.timeWarp = -1;
      CW.hud.overlay('TIME RUNS BACKWARDS', 3000);
      setTimeout(() => { CW.world.timeWarp = 1; }, 10000);
      find('TIME_THIEF');
    }
  }

  /* ---------- hold on sun ---------- */
  let holdTimer = null;
  function onHoldStart(hit) {
    clearTimeout(holdTimer);
    if (hit.type !== 'sun') return;
    holdTimer = setTimeout(() => {
      CW.world.flash = 1;
      CW.hud.overlay('SOLAR FLARE', 2500);
      find('SOLAR_FLARE');
    }, 3000);
  }
  function onHoldEnd() { clearTimeout(holdTimer); }

  /* ---------- corners (clockwise from top-left) ---------- */
  const CORNER_SEQ = ['TL', 'TR', 'BR', 'BL'];
  let cornerIdx = 0, cornerStart = 0;
  function onMove(x, y) {
    const { W, H } = CW.world.size, m = 24;
    const c = x < m && y < m ? 'TL' : x > W - m && y < m ? 'TR' : x > W - m && y > H - m ? 'BR' : x < m && y > H - m ? 'BL' : null;
    if (!c) return;
    if (c === CORNER_SEQ[cornerIdx]) {
      if (cornerIdx === 0) cornerStart = Date.now();
      cornerIdx++;
      if (cornerIdx === 4) {
        cornerIdx = 0;
        if (Date.now() - cornerStart < 8000) { CW.hud.overlay('PERIMETER SECURE', 2500); find('PERIMETER'); }
      }
    } else if (c !== CORNER_SEQ[cornerIdx - 1]) {
      cornerIdx = c === 'TL' ? 1 : 0;
      cornerStart = Date.now();
    }
  }

  /* ---------- time-based ---------- */
  function onMinute() {
    const d = new Date();
    const h = d.getHours(), m = d.getMinutes();
    if ((h === 3 || h === 15) && m === 33) {
      CW.hud.overlay('GHOST HOUR\nthe city exhales', 5000);
      find('GHOST_HOUR');
    }
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    const cursed = md === 1031 || md === 101 || (d.getDay() === 5 && d.getDate() === 13);
    if (cursed) {
      if (md === 1031 && CW.world.paletteName !== 'HALLOWNET') CW.world.setPalette('HALLOWNET');
      find('CALENDAR_GLITCH');
    }
  }

  function onIdle(ms) {
    const dreaming = ms > 5 * 60 * 1000;
    if (dreaming && !CW.world.dream) {
      CW.world.dream = true;
      CW.hud.overlay('do androids dream\nof electric sheep?', 7000);
      find('ELECTRIC_SHEEP');
    } else if (!dreaming && CW.world.dream) CW.world.dream = false;
  }

  CW.EGGS = EGGS;
  CW.eggs = { find, onKey, onHit, onClockClick, onHoldStart, onHoldEnd, onMove, onMinute, onIdle };
})();
