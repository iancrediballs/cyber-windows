/* NEON//OS — tiny WebAudio synth; no audio assets needed. */
(function () {
  'use strict';
  const CW = window.CW;
  let ac = null;
  let volume = 0.25;

  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur, type, when, gain) {
    const a = ctx(); if (!a || volume <= 0) return;
    const t0 = a.currentTime + (when || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime((gain || 0.15) * volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const sfx = {
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); },
    blip() { tone(880, 0.06, 'square', 0, 0.08); },
    pickup() { tone(660, 0.07, 'triangle'); tone(990, 0.09, 'triangle', 0.06); tone(1320, 0.12, 'triangle', 0.12); },
    hack() { for (let i = 0; i < 5; i++) tone(200 + Math.random() * 900, 0.04, 'sawtooth', i * 0.03, 0.06); },
    error() { tone(140, 0.25, 'sawtooth', 0, 0.12); },
    secret() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.08, 0.12)); },
    levelup() { [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'sawtooth', i * 0.07, 0.1)); },
  };

  CW.sfx = sfx;
})();
