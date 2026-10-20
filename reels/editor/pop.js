/* Open Frame pop layer for talking heads. makePop(W,H,spec).draw(ctx,t) paints one transparent frame and
   returns false when nothing is on screen. Brand rules (brands/open-frame/brand.json): flat ink-outlined
   illustrations on bold color fields, accents cycled red, blue, yellow, green, Fraunces headings.
   spec: {pal:{ink,cream,r,y,b,g}, intro:seconds, scenes:[{t,end,kind,label}], wipes:[{t,shape,color}]} */
function makePop(W, H, spec) {
  const P = spec.pal, U = Math.min(W, H) / 1080, TALL = H > W;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const eOutExpo = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x), eInExpo = x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
  const c1 = 1.70158, c3 = c1 + 1;
  const eOutBack = x => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  const eInBack = x => c3 * x * x * x - c1 * x * x;
  const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const LW = 7 * U, HEAD = spec.head || { family: "Fraunces", weight: 500 };

  function shape(ctx, kind, x, y, s, rot, fill, stroke) {
    if (s <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.beginPath();
    if (kind === "circle") ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    else if (kind === "square") ctx.rect(-s / 2, -s / 2, s, s);
    else { const h = s * Math.sqrt(3) / 2; ctx.moveTo(0, -h * 2 / 3); ctx.lineTo(s / 2, h / 3); ctx.lineTo(-s / 2, h / 3); ctx.closePath(); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = LW; ctx.lineJoin = "round"; ctx.strokeStyle = stroke; ctx.stroke(); }
    ctx.restore();
  }
  function box(ctx, x, y, w, h, r, fill, stroke) {
    if (w <= 0 || h <= 0) return;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = LW; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function line(ctx, x1, y1, x2, y2, col, lw) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = lw || LW; ctx.lineCap = "round"; ctx.strokeStyle = col; ctx.stroke();
  }
  function label(ctx, text, x, y, size, col, p, maxW) {
    if (p <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, p * 1.6);
    ctx.font = `${HEAD.weight} ${size}px "${HEAD.family}"`;
    const tw = ctx.measureText(text).width;
    if (maxW && tw > maxW) { size *= maxW / tw; ctx.font = `${HEAD.weight} ${size}px "${HEAD.family}"`; } ctx.fillStyle = col; ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + (1 - p) * size * .4); ctx.restore();
  }

  /* each scene draws an illustration in a box (ix, iy, iw, ih) with local time v */
  const FIELD = { design: "b", marketing: "y", brand: "r", social: "g", website: "b", product: "y", send: "g", newsletter: "r" };
  const ill = {
    marketing(ctx, v, x, y, w, h) { // a screen going off: bars climb, shapes burst out the top
      const sw = w * .5, sh = h * .62, sx = x + w * .12, sy = y + h * .3, p = eOutBack(seg(v, 0, .3));
      ctx.save(); ctx.translate(sx + sw / 2, sy + sh); ctx.scale(p, p); ctx.translate(-sx - sw / 2, -sy - sh);
      box(ctx, sx, sy, sw, sh, 18 * U, P.cream, P.ink);
      [[P.b, .45], [P.g, .7], [P.r, .95]].forEach(([c, k], i) => {
        const q = eOutBack(seg(v, .18 + i * .08, .45 + i * .08)), bh = (sh - 40 * U) * k * q;
        box(ctx, sx + sw * (.16 + i * .26), sy + sh - 20 * U - bh, sw * .18, bh, 6 * U, c, P.ink);
      });
      ctx.restore();
      [["circle", P.r, -.9], ["square", P.b, -.35], ["triangle", P.g, .25]].forEach(([k, c, a], i) => {
        const q = seg(v, .42 + i * .07, .95 + i * .07); if (q <= 0) return;
        const d = eOutExpo(q) * h * .55, ang = -Math.PI / 2 + a;
        shape(ctx, k, sx + sw * .55 + Math.cos(ang) * d * 1.3, sy + Math.sin(ang) * d * .55, 46 * U * (1 - .3 * q), q * 4, c, P.ink);
      });
      const r = seg(v, .4, .7); if (r > 0 && r < 1) [-.6, 0, .6].forEach(a => {
        const ang = -Math.PI / 2 + a, r0 = 30 * U + r * 60 * U;
        line(ctx, sx + sw / 2 + Math.cos(ang) * r0, sy - 10 * U + Math.sin(ang) * r0, sx + sw / 2 + Math.cos(ang) * (r0 + 40 * U), sy - 10 * U + Math.sin(ang) * (r0 + 40 * U), P.ink);
      });
    },
    design(ctx, v, x, y, w, h) { // an artboard: grid draws, shapes snap into the cells
      const aw = w * .6, ah = h * .78, ax = x + w * .06, ay = y + h * .11, p = eOutBack(seg(v, 0, .28));
      ctx.save(); ctx.translate(ax + aw / 2, ay + ah / 2); ctx.rotate((1 - p) * -.2); ctx.scale(p, p); ctx.translate(-ax - aw / 2, -ay - ah / 2);
      box(ctx, ax, ay, aw, ah, 10 * U, P.cream, P.ink);
      const g = eOutExpo(seg(v, .15, .45));
      line(ctx, ax + aw / 3, ay + 12 * U, ax + aw / 3, ay + 12 * U + (ah - 24 * U) * g, P.ink, LW * .5);
      line(ctx, ax + aw * 2 / 3, ay + 12 * U, ax + aw * 2 / 3, ay + 12 * U + (ah - 24 * U) * g, P.ink, LW * .5);
      line(ctx, ax + 12 * U, ay + ah / 2, ax + 12 * U + (aw - 24 * U) * g, ay + ah / 2, P.ink, LW * .5);
      const s = Math.min(aw / 3, ah / 2) * .6;
      [["circle", P.y, 0, 0], ["square", P.r, 1, 1], ["triangle", P.g, 2, 0]].forEach(([k, c, cx, cy], i) => {
        const q = eOutBack(seg(v, .32 + i * .09, .58 + i * .09)); if (q <= 0) return;
        const fx = ax + aw * (cx + .5) / 3, fy = ay + ah * (cy + .5) / 2;
        shape(ctx, k, fx, lerp(fy - ah * .5, fy, Math.min(q, 1)), s * q, (1 - q) * 2, c, P.ink);
      });
      ctx.restore();
      const cq = eOutExpo(seg(v, .55, .95)); // pointer clicks the last cell
      if (cq > 0) { const px = lerp(ax + aw * 1.1, ax + aw * .86, cq), py = lerp(ay + ah * 1.05, ay + ah * .34, cq);
        ctx.save(); ctx.translate(px, py); ctx.rotate(-.5); shape(ctx, "triangle", 0, 0, 44 * U, 0, P.ink); ctx.restore(); }
    },
    brand(ctx, v, x, y, w, h) { // swatch fan opens, then a stamp lands
      const px = x + w * .26, py = y + h * .9;
      [P.ink, P.b, P.y, P.cream, P.g].forEach((c, k) => {
        const q = eOutBack(seg(v, .04 + k * .05, .4 + k * .05)); if (q <= 0) return;
        ctx.save(); ctx.translate(px, py); ctx.rotate((-50 + k * 25) * Math.PI / 180 * q);
        box(ctx, -26 * U, -h * .72, 52 * U, h * .72, 12 * U, c, P.ink); ctx.restore();
      });
      const sp = seg(v, .45, .62);
      if (sp > 0) { const k = 1 + .6 * (1 - eInExpo(sp)), sx = x + w * .52, sy = y + h * .5, s = h * .48;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(lerp(-.4, -.08, eInExpo(sp))); ctx.scale(k, k); ctx.globalAlpha = Math.min(1, sp * 3);
        box(ctx, -s / 2, -s / 2, s, s, 14 * U, P.cream, P.ink);
        shape(ctx, "circle", -s * .12, s * .05, s * .42, 0, P.ink); shape(ctx, "triangle", s * .16, s * .1, s * .4, 0, P.y, P.ink);
        ctx.restore(); }
    },
    website(ctx, v, x, y, w, h) { // a browser window builds itself, then the button gets pressed
      const bw = w * .6, bh = h * .8, bx = x + w * .05, by = y + h * .1, p = eOutBack(seg(v, 0, .28));
      ctx.save(); ctx.translate(bx + bw / 2, by + bh); ctx.scale(1, p); ctx.translate(-bx - bw / 2, -by - bh);
      box(ctx, bx, by, bw, bh, 14 * U, P.cream, P.ink);
      line(ctx, bx, by + 50 * U, bx + bw, by + 50 * U, P.ink, LW * .7);
      [P.r, P.y, P.g].forEach((c, i) => shape(ctx, "circle", bx + 32 * U + i * 30 * U, by + 26 * U, 16 * U, 0, c));
      const hq = eOutExpo(seg(v, .2, .45));
      box(ctx, bx + 24 * U, by + 72 * U, (bw - 48 * U) * hq, bh * .3, 8 * U, P.b, P.ink);
      [.75, .5].forEach((k, i) => { const q = eOutExpo(seg(v, .35 + i * .08, .6 + i * .08));
        box(ctx, bx + 24 * U, by + 90 * U + bh * .3 + i * 30 * U, (bw - 48 * U) * k * q, 12 * U, 6 * U, P.ink); });
      const bq = eOutBack(seg(v, .5, .75)), press = 1 - .1 * Math.sin(seg(v, .85, 1) * Math.PI);
      if (bq > 0) { ctx.save(); ctx.translate(bx + 24 * U + 80 * U, by + bh - 50 * U); ctx.scale(bq * press, bq * press);
        box(ctx, -80 * U, -22 * U, 160 * U, 44 * U, 22 * U, P.r, P.ink); ctx.restore(); }
      ctx.restore();
    },
    social(ctx, v, x, y, w, h) { // a phone, a post, likes pile up
      const pw = h * .5, ph = h * .9, px = x + w * .18, py = y + h * .05, up = eOutExpo(seg(v, 0, .3));
      ctx.save(); ctx.translate(0, (1 - up) * h); ctx.rotate((1 - up) * .2);
      box(ctx, px, py, pw, ph, 30 * U, P.cream, P.ink);
      const pq = eOutBack(seg(v, .2, .45));
      if (pq > 0) box(ctx, px + 18 * U, py + 40 * U, (pw - 36 * U) * pq, ph * .45, 10 * U, P.y, P.ink);
      shape(ctx, "circle", px + pw * .5, py + 40 * U + ph * .22, ph * .16 * pq, 0, P.r, P.ink);
      box(ctx, px + 18 * U, py + ph * .62, (pw - 36 * U) * eOutExpo(seg(v, .35, .6)), 12 * U, 6 * U, P.ink);
      ctx.restore();
      for (let i = 0; i < 4; i++) { const q = seg(v, .5 + i * .1, 1.1 + i * .1); if (q <= 0 || q >= 1) continue;
        const bx = px + pw + 30 * U + i * 14 * U, byy = py + ph * .7 - eOutExpo(q) * ph * .7;
        ctx.save(); ctx.globalAlpha = 1 - eInExpo(q);
        shape(ctx, "circle", bx, byy, 40 * U, 0, P.r, P.ink); ctx.restore(); }
    },
    send(ctx, v, x, y, w, h) { // a paper airplane crosses, then: done, with a check
      const q = eIO(seg(v, 0, .7)), ax = lerp(x - w * .1, x + w * .62, q), ay = y + h * .55 - Math.sin(q * Math.PI) * h * .3;
      ctx.save(); ctx.setLineDash([16 * U, 16 * U]); ctx.beginPath();
      for (let k = 0; k <= 30; k++) { const qq = q * k / 30, xx = lerp(x - w * .1, x + w * .62, qq), yy = y + h * .55 - Math.sin(qq * Math.PI) * h * .3;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.lineWidth = LW * .6; ctx.strokeStyle = P.ink; ctx.stroke(); ctx.restore();
      if (q < 1) { const ang = Math.atan2(-Math.cos(q * Math.PI) * h * .3 * Math.PI, w * .72), s = h * .34;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(s * .6, 0); ctx.lineTo(-s * .5, -s * .38); ctx.lineTo(-s * .25, 0); ctx.lineTo(-s * .5, s * .38); ctx.closePath();
        ctx.fillStyle = P.cream; ctx.fill(); ctx.lineWidth = LW; ctx.lineJoin = "round"; ctx.strokeStyle = P.ink; ctx.stroke();
        line(ctx, s * .6, 0, -s * .25, 0, P.ink, LW * .7); ctx.restore(); }
      const d = eOutBack(seg(v, .62, .85)); if (d > 0) {
        const cx = x + w * .7, cy = y + h * .5, r = h * .26 * d;
        shape(ctx, "circle", cx, cy, r * 2, 0, P.ink);
        const k = seg(v, .75, .95); ctx.beginPath(); ctx.moveTo(cx - r * .45, cy + r * .02);
        if (k > 0) { ctx.lineTo(cx - r * .45 + r * .3 * Math.min(1, k * 2), cy + r * .02 + r * .3 * Math.min(1, k * 2));
          if (k > .5) ctx.lineTo(cx - r * .15 + r * .65 * (k - .5) * 2, cy + r * .32 - r * .65 * (k - .5) * 2); }
        ctx.lineWidth = LW * 1.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = P.cream; ctx.stroke();
      }
    },
  };
  ill.product = ill.social; ill.newsletter = ill.website;

  function scene(ctx, sc, t) {
    const v = t - sc.t, outv = seg(t, sc.end - .25, sc.end);
    if (v < 0 || outv >= 1) return false;
    const pw = W * (TALL ? .88 : .92), ph = H * (TALL ? .27 : .3), px0 = (W - pw) / 2, py = H * (TALL ? .05 : .03);
    const px = px0 + (1 - eOutExpo(seg(v, 0, .28))) * -W + eInExpo(outv) * W;
    const fk = FIELD[sc.kind] || "r", field = P[fk];
    ctx.save(); box(ctx, px, py, pw, ph, 22 * U, field, P.ink);
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 22 * U); ctx.clip();
    (ill[sc.kind] || ill.brand)(ctx, v, px + pw * .02, py + ph * .06, pw * .62, ph * .88);
    label(ctx, sc.label, px + pw * .6, py + ph * .5, ph * .24, fk === "y" ? P.ink : P.cream, eOutExpo(seg(v, .25, .55)), pw * .36);
    ctx.restore();
    return true;
  }

  /* video title: brand head font on a background shape, *word* in italic accent, pops in then wipes out */
  function title(ctx, t) {
    const T = spec.title; if (!T || t > T.until + .4) return false;
    const size = (TALL ? 92 : 80) * U, maxW = W * .8, parts = T.text.split(/(\*[^*]+\*)/).filter(Boolean);
    const words = []; parts.forEach(p => { const it = p.startsWith("*"); p.replace(/\*/g, "").split(/(\s+)/).forEach(w => w && words.push({ w, it })); });
    const font = it => `${it ? "italic " : ""}${HEAD.weight} ${size}px "${HEAD.family}"`;
    const lines = [[]]; let lw = 0;
    for (const x of words) { ctx.font = font(x.it); const ww = ctx.measureText(x.w).width;
      if (lw + ww > maxW && x.w.trim() && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
      if (!(lw === 0 && !x.w.trim())) { lines[lines.length - 1].push({ ...x, ww }); lw += ww; } }
    const widths = lines.map(l => l.reduce((a, x) => a + x.ww, 0)), bw = Math.max(...widths) + 90 * U, bh = lines.length * size * 1.15 + 70 * U;
    const cx = W / 2, cy = H * (TALL ? .2 : .18);
    const pin = eOutBack(seg(t, 0, .35)), out = eInBack(seg(t, T.until, T.until + .35));
    if (out >= 1) return false;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(lerp(-.08, -.03, pin) + out * .2); ctx.scale(pin * (1 - out), pin * (1 - out));
    shape(ctx, "circle", bw / 2 - 10 * U, -bh / 2 + 6 * U, 110 * U, 0, P[T.dot || "y"], P.ink); // accent dot behind the corner
    box(ctx, -bw / 2, -bh / 2, bw, bh, 18 * U, P[T.field || "r"], P.ink);
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => { let x = -widths[i] / 2; const y = -bh / 2 + 35 * U + size * 1.15 * (i + .5);
      l.forEach(wd => { ctx.font = font(wd.it); ctx.fillStyle = wd.it ? P[T.accent || "y"] : P.cream; ctx.fillText(wd.w, x, y); x += wd.ww; }); });
    ctx.restore();
    return true;
  }

  function draw(ctx, t) {
    ctx.clearRect(0, 0, W, H);
    let drew = false;
    if (spec.intro && t < spec.intro + .4) { // the Bauhaus trio slides in at the edges while the hook is up
      const i = eOutExpo(seg(t, 0, .5)), o = eInBack(seg(t, spec.intro - .1, spec.intro + .3)), s = 320 * U;
      shape(ctx, "circle", -s * .15 - o * s, H * .5, s * i, 0, P.r, P.ink);
      shape(ctx, "square", W + s * .05 + o * s, H * (TALL ? .2 : .25), s * .8 * i, (1 - i) * 1.5, P.b, P.ink);
      shape(ctx, "triangle", W - s * .1 + o * s, H * .62, s * .7 * i, (1 - i) * -2, P.y, P.ink);
      drew = true;
    }
    for (const sc of spec.scenes) drew = scene(ctx, sc, t) || drew;
    drew = title(ctx, t) || drew;
    for (const wp of spec.wipes) { // a big shape sweeps corner to corner and covers the cut at its midpoint
      if (t < wp.t - .22 || t > wp.t + .22) continue;
      const p = eIO(seg(t, wp.t - .22, wp.t + .22)), s = Math.hypot(W, H) * 1.15;
      shape(ctx, wp.shape, -s / 2 + p * (W + s), H + s / 2 - p * (H + s), s, wp.shape === "square" ? p * .6 : 0, P[wp.color]);
      drew = true;
    }
    return drew;
  }
  return { draw };
}
if (typeof module !== "undefined") module.exports = { makePop };
