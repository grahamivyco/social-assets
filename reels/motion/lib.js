/* Shared motion helpers for scenes. Everything is a pure function of time t (seconds),
   so any frame renders the same way every time. */
(function () {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    linear: k => k,
    inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
    outCubic: k => 1 - Math.pow(1 - k, 3),
    inCubic: k => k * k * k,
    inOutCubic: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    outExpo: k => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
    inExpo: k => (k <= 0 ? 0 : Math.pow(2, 10 * k - 10)),
    inOutExpo: k => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2),
    outBack: k => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  };
  // 0..1 progress of t through [a, b], eased
  const prog = (t, a, b, ease = 'linear') => E[ease](clamp((t - a) / (b - a)));
  // value tween: tw(t, a, b, from, to, ease)
  const tw = (t, a, b, from, to, ease = 'outExpo') => lerp(from, to, prog(t, a, b, ease));
  // damped spring settle, 0 -> 1 with overshoot, starting at t0
  const spring = (t, t0, freq = 2.2, damp = 5) => { const x = t - t0; if (x <= 0) return 0; return 1 - Math.exp(-damp * x) * Math.cos(2 * Math.PI * freq * x); };
  // beat grid (117 BPM by default, matches the reference)
  const beat = (n, bpm = 117) => (n * 60) / bpm;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const css = (el, o) => { if (typeof el === 'string') el = $(el); if (el) Object.assign(el.style, o); return el; };
  window.M = { clamp, lerp, E, prog, tw, spring, beat, $, $$, css };
})();
