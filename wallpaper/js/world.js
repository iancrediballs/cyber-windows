/* NEON//OS — world renderer: sky, skyline, grid, weather, drones, shards, megastructure, audio reactivity. */
(function () {
  'use strict';
  const CW = window.CW;

  const PALETTES = {
    NEON:      { minLvl: 1,  a: '#ff2bd6', b: '#00f0ff', c: '#fcee0a', skyTop: '#05010f', skyMid: '#1a0533', skyLow: '#3d0a4f' },
    ARASHI:    { minLvl: 5,  a: '#ff003c', b: '#ff8a00', c: '#ffffff', skyTop: '#0a0000', skyMid: '#2a0008', skyLow: '#5a0a14' },
    TOXIC:     { minLvl: 8,  a: '#39ff14', b: '#b026ff', c: '#e0ff4f', skyTop: '#000a03', skyMid: '#0b1f0a', skyLow: '#1e3d12' },
    AFTERLIFE: { minLvl: 10, a: '#ffcc00', b: '#ff5e00', c: '#fff5d6', skyTop: '#0d0700', skyMid: '#2b1600', skyLow: '#4d2a00' },
    HALLOWNET: { minLvl: 99, a: '#ff7a00', b: '#9d00ff', c: '#c6ff00', skyTop: '#060008', skyMid: '#1b0620', skyLow: '#3a0f1a' },
    RAINBOW:   { minLvl: 99, a: '#ff2bd6', b: '#00f0ff', c: '#fcee0a', skyTop: '#05010f', skyMid: '#1a0533', skyLow: '#3d0a4f' },
  };

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, HORIZON = 0;

  const world = {
    palette: PALETTES.NEON,
    paletteName: 'NEON',
    weather: 'clear',          // clear | rain | fog | storm
    intensity: 0.3,            // activity-driven 0..1
    audio: new Float32Array(128),
    audioLevel: 0,
    timeWarp: 1,               // -1 when TIME_THIEF egg active
    blackout: 0,               // seconds remaining of 404 egg
    rainbow: 0,                // seconds remaining of konami egg
    flash: 0,                  // lightning flash 0..1
    dream: false,
    moonCracked: false,
    t: 0,
    hotspots: {},              // name -> {x,y,r}
    signalWindow: null,
  };

  /* ---------- seeded RNG so the skyline is stable per level ---------- */
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const daySeed = () => { const d = new Date(); return d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate(); };

  /* ---------- skyline (cached offscreen) ---------- */
  let skyline = null; // { layers: [canvas], windows: [{x,y,w,h,phase,layer}] }

  function buildSkyline() {
    const lvl = CW.levelFor(CW.state.hp).lvl;
    const r = rng(1337 + lvl);
    const layers = [];
    const windows = [];
    const density = 24 + lvl * 4;
    const layerDefs = [
      { count: Math.round(density * 0.6), hMin: 0.12, hMax: 0.32, shade: 0.35, lit: 0.07 },
      { count: Math.round(density * 0.8), hMin: 0.10, hMax: 0.42 + lvl * 0.012, shade: 0.6, lit: 0.10 + lvl * 0.007 },
      { count: Math.round(density * 0.5), hMin: 0.08, hMax: 0.30, shade: 1, lit: 0.14 + lvl * 0.009 },
    ];
    layerDefs.forEach((def, li) => {
      const c = document.createElement('canvas');
      c.width = W * DPR; c.height = H * DPR;
      const g = c.getContext('2d');
      g.scale(DPR, DPR);
      for (let i = 0; i < def.count; i++) {
        const bw = 30 + r() * 90 * (li === 2 ? 1.3 : 1);
        let bh = H * (def.hMin + r() * (def.hMax - def.hMin));
        const bx = r() * (W + bw) - bw / 2;
        // keep a canyon open in the middle so the sun reads through the skyline
        if (Math.abs(bx + bw / 2 - W / 2) < W * 0.1 + bw / 2) bh = Math.min(bh, H * [0.06, 0.04, 0.025][li]);
        const by = HORIZON - bh + (li === 2 ? H * 0.02 : 0);
        const tone = Math.round(8 + 14 * def.shade);
        g.fillStyle = `rgb(${tone},${Math.round(tone * 0.6)},${tone + 12})`;
        g.fillRect(bx, by, bw, bh + H);
        // rim light
        g.fillStyle = 'rgba(255,255,255,0.04)';
        g.fillRect(bx, by, 2, bh);
        // antennas on tall buildings
        if (bh > H * 0.3 && r() < 0.6) {
          g.fillStyle = `rgb(${tone + 10},${tone},${tone + 20})`;
          g.fillRect(bx + bw / 2 - 1, by - 30 - r() * 40, 2, 40 + r() * 30);
        }
        // windows
        const cols = Math.floor(bw / 9), rows = Math.floor(bh / 12);
        for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < rows; cy++) {
          if (r() > def.lit) continue;
          const wx = bx + 4 + cx * 9, wy = by + 6 + cy * 12;
          windows.push({ x: wx, y: wy, w: 4, h: 6, phase: r() * 1000, layer: li, hue: r() });
        }
      }
      layers.push(c);
    });
    // pick the morse-signal window: a front-layer window near the center-ish
    const front = windows.filter((w) => w.layer === 2 && w.x > W * 0.25 && w.x < W * 0.75 && w.y > HORIZON - H * 0.25);
    world.signalWindow = front.length ? front[Math.floor(r() * front.length)] : null;
    skyline = { layers, windows };
  }

  /* ---------- particles / actors ---------- */
  let stars = [], rain = [], drones = [], shards = [], streams = [], bolts = [];

  function seedStars() {
    const r = rng(42);
    stars = Array.from({ length: 220 }, () => ({ x: r() * W, y: r() * HORIZON * 0.85, s: r() * 1.4 + 0.2, p: r() * 6 }));
  }

  function spawnDrone() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    drones.push({
      x: dir > 0 ? -60 : W + 60, y: H * (0.12 + Math.random() * 0.45), vx: dir * (40 + Math.random() * 90),
      bob: Math.random() * 6, size: 0.6 + Math.random() * 0.8, hacked: 0, kind: Math.random() < 0.25 ? 'car' : 'drone',
    });
  }

  function spawnShard() {
    shards.push({ x: W * (0.1 + Math.random() * 0.8), y: H * (0.2 + Math.random() * 0.4), born: world.t, life: 45, rot: 0 });
  }

  /* ---------- time of day ---------- */
  function dayPhase() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    // 0 = deep night, 1 = full "day" (still dusky — it's cyberpunk)
    return Math.max(0, Math.min(1, 1 - Math.abs(h - 13) / 7));
  }

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; }
  function alpha(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function rainbowHex(off) { const h = ((world.t * 60 + off) % 360); return `hsl(${h},100%,60%)`; }
  function A() { return world.rainbow > 0 ? rainbowHex(0) : world.palette.a; }
  function B() { return world.rainbow > 0 ? rainbowHex(120) : world.palette.b; }

  /* ---------- draw passes ---------- */
  function drawSky() {
    const p = world.palette, dp = dayPhase();
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
    g.addColorStop(0, mix(p.skyTop, '#1b2a4a', dp * 0.5));
    g.addColorStop(0.6, mix(p.skyMid, '#3a2a5a', dp * 0.4));
    g.addColorStop(1, mix(p.skyLow, '#ff6a3d', dp * 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HORIZON + 2);

    // stars fade in at night
    const starA = 1 - dp * 0.8;
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = starA * (0.4 + 0.6 * Math.abs(Math.sin(world.t * 0.8 + s.p)));
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawSun() {
    // retro striped sun sitting on the horizon (hold 5s → SOLAR_FLARE egg)
    const cx = W * 0.5, R = Math.min(W, H) * 0.15, cy = HORIZON - R * 0.75;
    world.hotspots.sun = { x: cx, y: cy, r: R * 0.9 };
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, world.palette.c);
    g.addColorStop(1, A());
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 12; i++) {
      const y = cy - R * 0.1 + i * (R * 0.095) + ((world.t * 6) % (R * 0.095));
      ctx.fillRect(cx - R, y, R * 2, 2 + i * 0.9);
    }
    ctx.restore();
    ctx.shadowColor = A();
    ctx.shadowBlur = 60 + world.audioLevel * 80;
    ctx.strokeStyle = alpha(world.palette.c, 0.15);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawMoon() {
    const x = W * 0.82, y = H * 0.14, r = Math.min(W, H) * 0.045;
    world.hotspots.moon = { x, y, r: r * 1.4 };
    ctx.save();
    ctx.shadowColor = B(); ctx.shadowBlur = 40;
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    [[-0.3, -0.2, 0.25], [0.35, 0.1, 0.18], [-0.05, 0.4, 0.14]].forEach(([dx, dy, rr]) => {
      ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); ctx.fill();
    });
    if (world.moonCracked) {
      // the moon is a lens. It always was.
      ctx.strokeStyle = A(); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.2); ctx.lineTo(x - r * 0.2, y); ctx.lineTo(x + r * 0.1, y - r * 0.6); ctx.lineTo(x + r, y - r * 0.3); ctx.stroke();
      const pulse = 0.5 + 0.5 * Math.sin(world.t * 3);
      ctx.fillStyle = alpha(world.palette.a, 0.6 + pulse * 0.4);
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.1, r * 0.5, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x + Math.sin(world.t) * r * 0.2, y + r * 0.1, r * 0.13, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawMegastructure() {
    if (!CW.hasLevel(9)) return;
    // orbital ring arc across the sky
    ctx.save();
    ctx.strokeStyle = alpha(world.palette.b, 0.25);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.95, W * 0.75, H * 0.85, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(world.palette.c, 0.35);
    ctx.setLineDash([2, 18]);
    ctx.lineDashOffset = -world.t * 30;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawSkyline() {
    if (!skyline) return;
    const par = (CW.input ? (CW.input.mx / Math.max(W, 1) - 0.5) : 0);
    skyline.layers.forEach((layer, i) => {
      const off = par * (i + 1) * -12;
      ctx.drawImage(layer, off, 0, W, H);
    });
    // windows glow / audio pulse
    const lvl6 = CW.hasLevel(6);
    const aL = world.audioLevel;
    for (const w of skyline.windows) {
      const off = par * (w.layer + 1) * -12;
      let on = Math.sin(world.t * 0.15 + w.phase) > -0.85;
      if (!on) continue;
      let col = w.hue < 0.5 ? world.palette.a : w.hue < 0.85 ? world.palette.b : world.palette.c;
      if (world.rainbow > 0) col = rainbowHex(w.hue * 360);
      let a = 0.35 + w.layer * 0.2;
      if (lvl6) a += world.audio[Math.floor(w.hue * 64)] * 0.8;
      ctx.fillStyle = col.startsWith('#') ? alpha(col, Math.min(1, a)) : col;
      ctx.fillRect(w.x + off, w.y, w.w, w.h);
    }
    // the signal window — blinks R-U-N in morse
    if (world.signalWindow) {
      const sw = world.signalWindow;
      const on = morseOn(world.t);
      const off = par * 3 * -12;
      world.hotspots.signal = { x: sw.x + off + 2, y: sw.y + 3, r: 14 };
      ctx.fillStyle = on ? '#ffffff' : '#140c1c';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = on ? 12 : 0;
      ctx.fillRect(sw.x + off - 1, sw.y - 1, sw.w + 2, sw.h + 2);
      ctx.shadowBlur = 0;
    }
  }

  // ".-." "..-" "-." = R U N ; unit = 0.22s
  const MORSE = (() => {
    const seq = []; const unit = (n, v) => { for (let i = 0; i < n; i++) seq.push(v); };
    ['.-.', '..-', '-.'].forEach((letter) => {
      [...letter].forEach((sym, i) => { unit(sym === '.' ? 1 : 3, 1); if (i < letter.length - 1) unit(1, 0); });
      unit(3, 0);
    });
    unit(6, 0);
    return seq;
  })();
  function morseOn(t) { return MORSE[Math.floor(t / 0.22) % MORSE.length] === 1; }

  function drawGrid() {
    const gy = HORIZON;
    const g = ctx.createLinearGradient(0, gy, 0, H);
    g.addColorStop(0, '#0b0216'); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(0, gy, W, H - gy);
    ctx.save();
    ctx.strokeStyle = A();
    ctx.shadowColor = A(); ctx.shadowBlur = 8;
    const speed = 0.35 + world.intensity * 1.2 + world.audioLevel * 1.5;
    const phase = (world.t * speed * world.timeWarp) % 1;
    for (let i = 0; i < 22; i++) {
      const z = (i + (phase < 0 ? phase + 1 : phase)) / 22;
      const y = gy + Math.pow(z, 2.2) * (H - gy);
      ctx.globalAlpha = 0.15 + z * 0.75;
      ctx.lineWidth = 0.6 + z * 1.6;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    const vx = W / 2;
    for (let i = -24; i <= 24; i++) {
      ctx.beginPath(); ctx.moveTo(vx + i * 6, gy); ctx.lineTo(vx + i * W * 0.09, H); ctx.stroke();
    }
    ctx.restore();
    // horizon haze
    const hz = ctx.createLinearGradient(0, gy - 40, 0, gy + 30);
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.5, alpha(world.palette.a, 0.28)); hz.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, gy - 40, W, 70);
  }

  function drawEqualizer() {
    if (!CW.hasLevel(6) || world.audioLevel < 0.01) return;
    const n = 64, bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = world.audio[i];
      const h = v * H * 0.18;
      ctx.fillStyle = alpha(i % 2 ? world.palette.a : world.palette.b, 0.35);
      ctx.fillRect(i * bw + 1, HORIZON - h, bw - 2, h);
    }
  }

  function drawStreams(dt) {
    if (!CW.hasLevel(6)) return;
    if (streams.length < 24 && Math.random() < 0.08) {
      streams.push({ x: Math.random() * W, y: -20, v: 120 + Math.random() * 260, len: 6 + Math.floor(Math.random() * 14), chars: [] });
    }
    ctx.font = '12px "Share Tech Mono", monospace';
    for (let i = streams.length - 1; i >= 0; i--) {
      const s = streams[i];
      s.y += s.v * dt;
      for (let k = 0; k < s.len; k++) {
        const ch = String.fromCharCode(0x30a0 + ((Math.floor(world.t * 10) + k * 7 + i) % 96));
        ctx.fillStyle = k === 0 ? '#fff' : alpha(world.palette.b, 0.6 * (1 - k / s.len));
        ctx.fillText(ch, s.x, s.y - k * 14);
      }
      if (s.y - s.len * 14 > HORIZON) streams.splice(i, 1);
    }
  }

  function drawDrones(dt) {
    if (!CW.hasLevel(3)) { drones.length = 0; return; }
    if (drones.length < 3 + CW.levelFor(CW.state.hp).lvl && Math.random() < dt * 0.5) spawnDrone();
    for (let i = drones.length - 1; i >= 0; i--) {
      const d = drones[i];
      d.x += d.vx * dt * (d.hacked ? 3 : 1);
      if (d.hacked) d.y -= 60 * dt;
      const y = d.y + Math.sin(world.t * 2 + d.bob) * 4;
      const s = d.size;
      ctx.save();
      ctx.translate(d.x, y);
      if (d.kind === 'car') {
        ctx.fillStyle = '#0d0d18';
        ctx.fillRect(-22 * s, -5 * s, 44 * s, 10 * s);
        ctx.fillStyle = d.hacked ? world.palette.c : (d.vx > 0 ? '#fff' : '#ff2040');
        ctx.fillRect(d.vx > 0 ? 18 * s : -22 * s, -2 * s, 4 * s, 3 * s);
        ctx.fillStyle = alpha(world.palette.b, 0.7);
        ctx.fillRect(-16 * s, 5 * s, 32 * s, 1.5);
      } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(-8 * s, -3 * s, 16 * s, 6 * s);
        ctx.fillStyle = (Math.floor(world.t * 3 + i) % 2) ? (d.hacked ? world.palette.c : '#ff2040') : '#330008';
        ctx.beginPath(); ctx.arc(0, 4 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = alpha(world.palette.b, 0.12);
        ctx.beginPath(); ctx.moveTo(0, 5 * s); ctx.lineTo(-8 * s, 80 * s); ctx.lineTo(8 * s, 80 * s); ctx.closePath(); ctx.stroke();
      }
      if (d.hacked) {
        ctx.fillStyle = world.palette.c; ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillText('PWNED', -14, -10);
      }
      ctx.restore();
      if (d.x < -100 || d.x > W + 100 || d.y < -40) drones.splice(i, 1);
    }
  }

  function drawShards() {
    if (shards.length < 2 && Math.random() < 1 / (60 * 90)) spawnShard(); // ~one every 90s @60fps
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      const age = world.t - s.born;
      if (age > s.life) { shards.splice(i, 1); continue; }
      const y = s.y + Math.sin(world.t * 1.5 + i) * 8;
      const fade = Math.min(1, age, s.life - age);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(s.x, y);
      ctx.rotate(world.t * 1.2);
      ctx.shadowColor = world.palette.c; ctx.shadowBlur = 20;
      ctx.strokeStyle = world.palette.c; ctx.lineWidth = 2;
      ctx.strokeRect(-8, -8, 16, 16);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = world.palette.b;
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
      s.hit = { x: s.x, y, r: 18 };
    }
  }

  function drawWeather(dt) {
    const w = CW.hasLevel(2) ? world.weather : 'clear';
    if (w === 'rain' || w === 'storm') {
      const target = (w === 'storm' ? 420 : 220) * (0.6 + world.intensity * 0.6);
      while (rain.length < target) rain.push({ x: Math.random() * W * 1.2, y: Math.random() * H, v: 500 + Math.random() * 500, l: 8 + Math.random() * 14 });
      if (rain.length > target) rain.length = Math.floor(target);
      ctx.strokeStyle = alpha(world.palette.b, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of rain) {
        d.y += d.v * dt; d.x -= d.v * dt * 0.15;
        if (d.y > H) { d.y = -20; d.x = Math.random() * W * 1.2; }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.15, d.y - d.l);
      }
      ctx.stroke();
    } else rain.length = 0;

    if (w === 'fog') {
      for (let i = 0; i < 3; i++) {
        const fy = HORIZON - 80 + i * 50;
        const g = ctx.createLinearGradient(0, fy - 60, 0, fy + 60);
        g.addColorStop(0, 'rgba(120,80,160,0)'); g.addColorStop(0.5, 'rgba(120,80,160,0.12)'); g.addColorStop(1, 'rgba(120,80,160,0)');
        ctx.fillStyle = g; ctx.fillRect(0, fy - 60, W, 120);
      }
    }

    if (w === 'storm' && CW.hasLevel(8)) {
      if (Math.random() < dt * 0.15) {
        const x = Math.random() * W; const pts = [[x, 0]]; let y = 0, cx = x;
        while (y < HORIZON - 60) { y += 20 + Math.random() * 40; cx += (Math.random() - 0.5) * 60; pts.push([cx, y]); }
        bolts.push({ pts, life: 0.35 }); world.flash = 1;
      }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.life -= dt;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255,255,255,${b.life * 2.5})`; ctx.lineWidth = 2;
      ctx.shadowColor = world.palette.b; ctx.shadowBlur = 25;
      ctx.beginPath(); b.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (world.flash > 0) {
      ctx.fillStyle = `rgba(220,230,255,${world.flash * 0.25})`; ctx.fillRect(0, 0, W, H);
      world.flash = Math.max(0, world.flash - dt * 3);
    }
  }

  function drawBillboard() {
    if (!CW.hasLevel(7)) return;
    const bx = W * 0.08, by = H * 0.22, bw = Math.min(320, W * 0.22), bh = bw * 0.42;
    world.hotspots.billboard = { x: bx + bw / 2, y: by + bh / 2, r: bw / 2 };
    const flick = Math.random() < 0.02 ? 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = 0.85 * flick;
    ctx.fillStyle = 'rgba(10,0,20,0.7)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = A(); ctx.shadowColor = A(); ctx.shadowBlur = 18; ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    const msg = CW.billboardText ? CW.billboardText() : 'NEON//OS';
    ctx.fillStyle = B();
    ctx.font = `${Math.round(bh * 0.2)}px Orbitron, "Share Tech Mono", sans-serif`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(msg).width;
    const scroll = tw > bw - 20 ? ((world.t * 60) % (tw + bw)) : 0;
    ctx.beginPath(); ctx.rect(bx + 6, by, bw - 12, bh); ctx.clip();
    ctx.fillText(msg, tw > bw - 20 ? bx + bw - scroll : bx + (bw - tw) / 2, by + bh / 2);
    ctx.restore();
    // support struts
    ctx.fillStyle = '#0b0614';
    ctx.fillRect(bx + bw * 0.2, by + bh, 4, HORIZON - by - bh);
    ctx.fillRect(bx + bw * 0.8, by + bh, 4, HORIZON - by - bh);
  }

  function drawPost() {
    // scanlines + vignette + chromatic sync glitch
    if (world.dream) { ctx.fillStyle = 'rgba(40,0,60,0.35)'; ctx.fillRect(0, 0, W, H); }
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (Math.random() < 0.004 + world.intensity * 0.004) glitchSlice();
  }

  function glitchSlice() {
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const y = Math.random() * H, h = 4 + Math.random() * 30, dx = (Math.random() - 0.5) * 60;
      try { ctx.drawImage(canvas, 0, y * DPR, W * DPR, h * DPR, dx, y, W, h); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- frame ---------- */
  function frame(dt) {
    world.t += dt * (world.timeWarp < 0 ? -1 : 1);
    world.rainbow = Math.max(0, world.rainbow - dt);
    // audio smoothing
    let sum = 0; for (let i = 0; i < 64; i++) sum += world.audio[i];
    world.audioLevel = world.audioLevel * 0.85 + (sum / 64) * 0.15;
    for (let i = 0; i < 128; i++) world.audio[i] *= 0.92;

    if (world.blackout > 0) {
      world.blackout -= dt;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = world.palette.a; ctx.font = '48px Orbitron, monospace'; ctx.textAlign = 'center';
      ctx.fillText('404 — CITY NOT FOUND', W / 2, H / 2); ctx.textAlign = 'left';
      return;
    }
    drawSky();
    drawMegastructure();
    drawMoon();
    drawSun();
    drawEqualizer();
    drawSkyline();
    drawBillboard();
    drawGrid();
    drawStreams(dt);
    drawDrones(dt);
    drawShards();
    drawWeather(dt);
    drawPost();
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    HORIZON = Math.round(H * 0.66);
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seedStars();
    buildSkyline();
  }

  /* ---------- public API ---------- */
  function setPalette(name) {
    const p = PALETTES[name];
    if (!p) return false;
    world.palette = p; world.paletteName = name;
    document.documentElement.style.setProperty('--a', p.a);
    document.documentElement.style.setProperty('--b', p.b);
    document.documentElement.style.setProperty('--c', p.c);
    return true;
  }

  function rollWeather() {
    const r = rng(daySeed() + new Date().getHours() / 6 | 0)();
    world.weather = r < 0.35 ? 'clear' : r < 0.65 ? 'rain' : r < 0.82 ? 'fog' : 'storm';
  }

  function hitTest(x, y) {
    for (let i = shards.length - 1; i >= 0; i--) {
      const h = shards[i].hit;
      if (h && Math.hypot(x - h.x, y - h.y) < h.r) { shards.splice(i, 1); return { type: 'shard' }; }
    }
    for (const d of drones) {
      if (d.hacked) continue;
      const dy = d.y + Math.sin(world.t * 2 + d.bob) * 4;
      if (Math.abs(x - d.x) < 26 * d.size && Math.abs(y - dy) < 14 * d.size) { d.hacked = 1; return { type: 'drone' }; }
    }
    for (const [name, h] of Object.entries(world.hotspots)) {
      if (h && Math.hypot(x - h.x, y - h.y) < h.r) return { type: name };
    }
    return { type: 'city' };
  }

  CW.world = Object.assign(world, {
    PALETTES, frame, resize, setPalette, rollWeather, hitTest, buildSkyline, spawnShard, glitchSlice,
  });
  Object.defineProperty(world, 'size', { get: () => ({ W, H, HORIZON }) });
})();
