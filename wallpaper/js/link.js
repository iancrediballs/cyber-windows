/* NEON//OS — Neural Link: bridges the local PowerShell daemon (real Windows navigation → HP) and Lively Wallpaper hooks. */
(function () {
  'use strict';
  const CW = window.CW;

  const link = { online: false, url: 'http://localhost:47777/state', lastSeq: 0, failStreak: 0 };
  const HP = { switches: 1, launches: 3, apps: 25, folders: 8 };
  const MAX_AWARD_PER_POLL = 300;

  function setPort(port) {
    const p = parseInt(port, 10);
    if (p > 1023 && p < 65536) link.url = `http://localhost:${p}/state`;
  }

  async function poll() {
    let data;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(link.url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) {
      link.failStreak++;
      if (link.online && link.failStreak > 2) setOnline(false);
      return;
    }
    link.failStreak = 0;
    if (!link.online) setOnline(true);
    ingest(data);
  }

  function setOnline(on) {
    link.online = on;
    const el = document.getElementById('link');
    el.textContent = on ? 'LINK: ONLINE' : 'LINK: OFFLINE';
    el.classList.toggle('on', on);
    if (on) CW.unlockAchievement('LINK_ONLINE');
  }

  function ingest(data) {
    const totals = data && data.totals;
    if (!totals) return;
    const s = CW.state.link;
    let earned = 0;
    for (const k of Object.keys(HP)) {
      const now = Number(totals[k]) || 0;
      const delta = now - (s[k] || 0);
      if (delta > 0) earned += delta * HP[k];
      s[k] = now; // daemon resets (delta < 0) just resync
    }
    CW.save();
    if (earned > 0) CW.award(Math.min(earned, MAX_AWARD_PER_POLL), 'NEURAL LINK ACTIVITY', { quiet: earned < 20 });

    // named discoveries → toasts
    (data.events || []).forEach((ev) => {
      if (ev.seq <= link.lastSeq) return;
      link.lastSeq = ev.seq;
      if (ev.type === 'app') CW.hud.toast('', 'NEW DISTRICT DISCOVERED', String(ev.name).toUpperCase());
      if (ev.type === 'folder') CW.hud.toast('', 'SECTOR MAPPED', String(ev.name));
    });

    // activity drives city intensity
    if (typeof data.activity === 'number') CW.world.intensity = Math.max(CW.world.intensity, Math.min(1, data.activity));

    if (s.apps >= 10) CW.unlockAchievement('APPS_10');
    if (s.apps >= 40) CW.unlockAchievement('APPS_40');
    if (s.folders >= 25) CW.unlockAchievement('FOLDERS_25');
    if (s.folders >= 150) CW.unlockAchievement('FOLDERS_150');
    if (s.switches >= 500) CW.unlockAchievement('SWITCH_500');
    CW.hud.renderStatus();
  }

  /* ---------- Lively Wallpaper hooks (global functions Lively calls) ---------- */
  window.livelyPropertyListener = function (name, val) {
    switch (name) {
      case 'showHud': document.getElementById('hud').classList.toggle('off', !val); break;
      case 'fpsCap': CW.fpsCap = Number(val) || 60; break;
      case 'sfxVolume': CW.sfx.setVolume(Number(val) / 100); break;
      case 'linkPort': setPort(val); break;
      case 'resetProgress': CW.reset(false); break;
      default: break;
    }
  };

  window.livelyAudioListener = function (audioArray) {
    const a = CW.world.audio;
    for (let i = 0; i < a.length && i < audioArray.length; i++) a[i] = Math.max(a[i], Math.min(1, audioArray[i]));
  };

  window.livelyCurrentTrack = function (data) {
    try {
      const t = typeof data === 'string' ? JSON.parse(data) : data;
      CW.setTrack(t && t.Title ? (t.Artist ? t.Artist + ' — ' : '') + t.Title : null);
    } catch (e) { CW.setTrack(null); }
  };

  CW.link = link;
  CW.linkStart = () => { poll(); setInterval(poll, 2000); };
  CW.linkSetPort = setPort;
})();
