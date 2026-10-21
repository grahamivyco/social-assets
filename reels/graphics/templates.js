/* Reusable explainer graphics for talking head Reels, drawn in the browser (render.js drives it).
   makeGraphic(spec) -> { set(t), check() }. spec: { kind, params, look, pal, W, H, dur }
   kinds: stat {label, from, to, unit, note} | compare {label, before:{title,value}, after:{title,value}}
          steps {label, steps:[2-4]} | quote {text with one *accent* word}
   looks: cream (cream panel, ink text) | color (accent field) | ink (ink panel, cream text) */
(function () {
  const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
  const span = (t, a, b) => ease((t - a) / (b - a));
  const lum = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const num = v => { const m = String(v).match(/-?[\d.]+/); return m ? parseFloat(m[0]) : 0; };

  window.makeGraphic = function (spec) {
    const { kind, params: p = {}, look = 'cream', pal, W = 1080, H = 1920, dur = 3.5 } = spec;
    const acc = pal[spec.accent || 'r'];
    const bg = look === 'ink' ? pal.ink : look === 'color' ? acc : pal.cream;
    const fg = look === 'ink' ? pal.cream : look === 'color' ? (lum(acc) > 0.35 ? pal.ink : pal.cream) : pal.ink;
    const hi = look === 'color' ? fg : acc;           // highlight color inside the panel
    const soft = look === 'color' ? (fg === pal.ink ? 'rgba(17,17,16,.18)' : 'rgba(243,241,234,.25)') : look === 'ink' ? 'rgba(243,241,234,.14)' : 'rgba(17,17,16,.1)';
    const shape = look === 'color' ? (fg === pal.ink ? pal.cream : pal.ink) : acc;
    const root = document.getElementById('g');
    root.innerHTML = '';
    root.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;overflow:hidden`;
    const panel = document.createElement('div');
    panel.style.cssText = `position:absolute;left:60px;top:200px;width:${W - 120}px;height:860px;border-radius:44px;background:${bg};color:${fg};overflow:hidden;transform-origin:50% 60%`;
    root.append(panel);
    const deco = document.createElement('div');   // Bauhaus corner shape
    deco.style.cssText = `position:absolute;right:-110px;bottom:-110px;width:300px;height:300px;border-radius:50%;background:${shape}`;
    panel.append(deco);
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:64px;right:64px;top:64px;bottom:64px;display:flex;flex-direction:column';
    panel.append(box);
    const label = p.label ? `<div class="fit" style="font:600 30px In;letter-spacing:.14em;text-transform:uppercase;opacity:.8;white-space:nowrap;overflow:hidden">${esc(p.label)}</div>` : '';
    let anim = () => {};

    if (kind === 'stat') {
      const from = num(p.from), to = num(p.to), unit = esc(p.unit || ''), dec = /\./.test(String(p.to)) ? 1 : 0;
      box.innerHTML = `${label}
        <div class="fit" style="flex:1;display:flex;align-items:center;font:500 300px/1 Fr;letter-spacing:-.03em;white-space:nowrap;overflow:hidden"><span id="n"></span><span style="font-size:.45em;margin-left:12px">${unit}</span></div>
        <div style="height:28px;border-radius:14px;background:${soft};overflow:hidden"><div id="bar" style="height:100%;border-radius:14px;background:${hi}"></div></div>
        <div class="fit" style="font:600 44px/1.3 In;margin-top:30px;max-height:120px;overflow:hidden">${esc(p.note || '')}</div>`;
      const n = box.querySelector('#n'), bar = box.querySelector('#bar'), top = Math.max(Math.abs(from), Math.abs(to)) || 1;
      anim = t => { const k = span(t, .45, 1.8), v = from + (to - from) * k; n.textContent = v.toFixed(dec); bar.style.width = (Math.abs(v) / top * 100) + '%'; };
    } else if (kind === 'compare') {
      const col = (s, c, id) => `<div id="${id}" style="flex:1;border-radius:28px;padding:36px;background:${c};display:flex;flex-direction:column;justify-content:space-between;overflow:hidden">
        <div class="fit" style="font:600 38px/1.25 In;max-height:100px;overflow:hidden">${esc(s.title)}</div>
        <div class="fit" style="font:500 210px/1.2 Fr;letter-spacing:-.02em;white-space:nowrap;overflow:hidden">${esc(s.value)}</div></div>`;
      box.innerHTML = `${label}<div style="flex:1;display:flex;gap:28px;margin-top:36px">${col(p.before || {}, soft, 'a')}${col(p.after || {}, hi === fg ? soft : hi, 'b')}</div>`;
      if (hi !== fg) box.querySelector('#b').style.color = lum(hi) > .35 ? pal.ink : pal.cream;
      const a = box.querySelector('#a'), b = box.querySelector('#b');
      anim = t => { const ka = span(t, .35, .8), kb = span(t, .9, 1.4);
        a.style.opacity = ka; a.style.transform = `translateY(${(1 - ka) * 60}px)`;
        b.style.opacity = kb; b.style.transform = `translateY(${(1 - kb) * 60}px)`; };
    } else if (kind === 'steps') {
      const steps = (p.steps || []).slice(0, 4);
      box.innerHTML = `${label}<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:40px">${steps.map((s, i) =>
        `<div class="st" style="display:flex;align-items:center;gap:30px"><div style="flex:none;width:140px;height:140px;border-radius:50%;background:${hi};color:${hi === fg ? bg : (lum(hi) > .35 ? pal.ink : pal.cream)};display:grid;place-items:center;font:500 80px Fr">${i + 1}</div>
         <div class="fit" style="font:500 84px/1.08 Fr;max-height:184px;overflow:hidden">${esc(s)}</div></div>`).join('')}</div>`;
      const els = [...box.querySelectorAll('.st')];
      anim = t => els.forEach((e, i) => { const k = span(t, .4 + i * .35, .8 + i * .35); e.style.opacity = k; e.style.transform = `translateX(${(1 - k) * -80}px)`; });
    } else if (kind === 'quote') {
      let lit = false;
      const words = String(p.text || '').split(/\s+/).filter(Boolean).map(w => {
        const on = !lit && /^\*.*\*[.,!?]*$/.test(w); if (on) lit = true;
        const t = esc(w.replace(/\*/g, ''));
        return `<span class="w" style="display:inline-block${on ? `;font-style:italic;color:${hi}` : ''}">${t}</span>`;
      });
      box.innerHTML = `${label}<div style="flex:1;display:flex;align-items:center"><div class="fit q" style="font:500 124px/1.08 Fr;max-height:680px;overflow:hidden">${words.join(' ')}</div></div>`;
      const ws = [...box.querySelectorAll('.w')];
      anim = t => ws.forEach((e, i) => { const k = span(t, .35 + i * .07, .65 + i * .07); e.style.opacity = k; e.style.transform = `translateY(${(1 - k) * 30}px)`; });
    } else throw new Error('unknown kind ' + kind);

    // Shrink any text that doesn't fit, down to 60% of its size. check() reports what still overflows.
    const over = e => e.scrollWidth > e.clientWidth + 4 || e.scrollHeight > e.clientHeight + 6;
    anim(dur);
    box.querySelectorAll('.fit').forEach(e => {
      const base = parseFloat(getComputedStyle(e).fontSize);
      for (let s = base; over(e) && s > base * .6; s -= 2) e.style.fontSize = s + 'px';
    });
    return {
      set(t) {
        const kin = span(t, 0, .4), kout = span(t, dur - .35, dur);
        panel.style.opacity = Math.min(kin, 1 - kout);
        panel.style.transform = `translateY(${(1 - kin) * 80 + kout * -40}px) scale(${.94 + .06 * kin})`;
        deco.style.transform = `scale(${span(t, .15, .7)})`;
        anim(t);
      },
      check() {
        anim(dur);
        return [...box.querySelectorAll('.fit')].filter(over).map(e => 'text does not fit: "' + e.textContent.trim().slice(0, 40) + '"');
      },
    };
  };
})();
