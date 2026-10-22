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
  /* ---- beat graphics (2026-10-22): one per idea Graham says, picked by hand in edit.json "beats" ---- */
  function person(ctx, x, y, s, col, p) { // a flat figure: head + rounded body, feet at (x, y)
    if (p <= 0) return; ctx.save(); ctx.translate(x, y); ctx.scale(p, p);
    box(ctx, -s * .42, -s * .62, s * .84, s * .62, s * .36, col, P.ink);
    shape(ctx, "circle", 0, -s * .86, s * .42, 0, P.cream, P.ink); ctx.restore();
  }
  function file(ctx, x, y, w, h, tag) { // a document with a folded corner and a colored tag
    const f = w * .28; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w - f, y); ctx.lineTo(x + w, y + f); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fillStyle = P.cream; ctx.fill(); ctx.lineWidth = LW; ctx.lineJoin = "round"; ctx.strokeStyle = P.ink; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - f, y); ctx.lineTo(x + w - f, y + f); ctx.lineTo(x + w, y + f); ctx.stroke();
    box(ctx, x - w * .12, y + h * .5, w * .78, h * .24, 6 * U, tag, P.ink);
    [.18, .3].forEach(k => box(ctx, x + w * .14, y + h * k + h * .04, w * .5, 6 * U, 3 * U, P.ink));
  }
  function bin(ctx, x, y, w, h, lid) { // a trash bin, lid tips open by `lid` (0..1)
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w * .88, y + h); ctx.lineTo(x + w * .12, y + h); ctx.closePath();
    ctx.fillStyle = P.cream; ctx.fill(); ctx.lineWidth = LW; ctx.lineJoin = "round"; ctx.strokeStyle = P.ink; ctx.stroke();
    [.35, .5, .65].forEach(k => line(ctx, x + w * k, y + h * .2, x + w * k, y + h * .8, P.ink, LW * .6));
    ctx.save(); ctx.translate(x - 6 * U, y - 4 * U); ctx.rotate(-lid * .7);
    box(ctx, 0, -18 * U, w + 12 * U, 18 * U, 6 * U, P.r, P.ink); box(ctx, w / 2 - 14 * U, -32 * U, 40 * U, 14 * U, 6 * U, P.r, P.ink); ctx.restore();
  }
  function text(ctx, s, x, y, size, col, italic, align) {
    ctx.save(); ctx.font = `${italic ? "italic " : ""}${HEAD.weight} ${size}px "${HEAD.family}"`; ctx.fillStyle = col;
    ctx.textBaseline = "middle"; ctx.textAlign = align || "center"; ctx.fillText(s, x, y); ctx.restore();
  }
  function browser(ctx, bx, by, bw, bh) {
    box(ctx, bx, by, bw, bh, 14 * U, P.cream, P.ink);
    line(ctx, bx, by + 46 * U, bx + bw, by + 46 * U, P.ink, LW * .7);
    [P.r, P.y, P.g].forEach((c, i) => shape(ctx, "circle", bx + 30 * U + i * 28 * U, by + 23 * U, 15 * U, 0, c));
  }
  Object.assign(ill, {
    pdfs(ctx, v, x, y, w, h) { // old PDFs drop in, a "2019" tag swings, then they slide into the bin
      const fw = h * .4, fh = h * .52, gone = eInBack(seg(v, 1.05, 1.5));
      bin(ctx, x + w * .66, y + h * .42, h * .36, h * .48, eOutBack(seg(v, .8, 1.05)) * (1 - seg(v, 1.4, 1.6)));
      [0, 1, 2].forEach(k => {
        const q = eOutBack(seg(v, k * .1, .35 + k * .1)); if (q <= 0) return;
        const fx = x + w * .04 + k * fw * .42, fy = y + h * .12 + k * h * .05;
        const tx = lerp(fx, x + w * .66 + h * .18 - fw / 2, gone), ty = lerp(fy, y + h * .3, gone);
        ctx.save(); ctx.translate(tx + fw / 2, ty + fh / 2); ctx.rotate((k - 1) * .12 + gone * 1.2); const s = q * (1 - gone * .6); ctx.scale(s, s);
        if (gone < .98) file(ctx, -fw / 2, -fh / 2, fw, fh, [P.r, P.b, P.r][k]); ctx.restore();
      });
      const tq = eOutBack(seg(v, .35, .6)) * (1 - seg(v, 1.0, 1.2));
      if (tq > 0) { ctx.save(); ctx.translate(x + w * .44, y + h * .14); ctx.rotate(.18 + Math.sin(v * 9) * .06 * (1 - seg(v, .6, 1)));
        ctx.scale(tq, tq); box(ctx, -62 * U, -26 * U, 124 * U, 52 * U, 26 * U, P.y, P.ink); text(ctx, "2019", 0, 2 * U, 34 * U, P.ink); ctx.restore(); }
    },
    menu(ctx, v, x, y, w, h) { // a crowded menu: 12 items, half fall away, 6 slide together
      const d = sc => sc.data || {}, n = 12, keep = 6;
      const px = x + w * .04, py = y + h * .06, pw = w * .9, ph = h * .86, pq = eOutBack(seg(v, 0, .3));
      ctx.save(); ctx.translate(px + pw / 2, py + ph / 2); ctx.scale(pq, pq); ctx.translate(-px - pw / 2, -py - ph / 2);
      box(ctx, px, py, pw, ph, 16 * U, P.cream, P.ink);
      const drop = seg(v, .7, 1.2), slide = eIO(seg(v, 1.1, 1.5));
      for (let i = 0; i < n; i++) {
        const q = eOutBack(seg(v, .12 + i * .035, .35 + i * .035)); if (q <= 0) continue;
        const col = i % 3, row = Math.floor(i / 3), cw = (pw - 60 * U) / 3, rh = (ph - 60 * U) / 4;
        let ix = px + 20 * U + col * (cw + 10 * U), iy = py + 20 * U + row * (rh + 7 * U);
        const out = i % 2 === 1;
        if (out) { iy += eInExpo(drop) * h * 1.2; if (drop >= 1) continue; }
        else { const k = i / 2, c2 = k % 2, r2 = Math.floor(k / 2), cw2 = (pw - 50 * U) / 2, rh2 = (ph - 54 * U) / 3;
          ix = lerp(ix, px + 20 * U + c2 * (cw2 + 10 * U), slide); iy = lerp(iy, py + 20 * U + r2 * (rh2 + 7 * U), slide);
          box(ctx, ix, iy, lerp(cw, cw2, slide) * q, lerp(rh, rh2, slide), 12 * U, [P.b, P.y, P.g, P.r][k % 4], P.ink); continue; }
        ctx.save(); ctx.translate(ix + cw / 2, iy + rh / 2); ctx.rotate(out ? drop * (i % 4 - 1.5) : 0);
        box(ctx, -cw / 2, -rh / 2, cw * q, rh, 12 * U, P.ink, P.ink); ctx.restore();
      }
      ctx.restore();
    },
    stock(ctx, v, x, y, w, h) { // a stock photo of strangers gets crossed out, flips to your real people
      const fx = x + w * .06, fy = y + h * .08, fw = w * .8, fh = h * .84, pq = eOutBack(seg(v, 0, .3));
      const flip = seg(v, .9, 1.25), sx = Math.abs(Math.cos(flip * Math.PI)), real = flip > .5;
      ctx.save(); ctx.translate(fx + fw / 2, fy + fh / 2); ctx.scale(pq * Math.max(sx, .02), pq); ctx.translate(-fx - fw / 2, -fy - fh / 2);
      box(ctx, fx, fy, fw, fh, 14 * U, real ? P.y : P.cream, P.ink);
      ctx.save(); ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 14 * U); ctx.clip();
      const cols = real ? [P.r, P.b, P.g] : ["#b9b6ad", "#b9b6ad", "#b9b6ad"];
      [-1, 0, 1].forEach((k, i) => person(ctx, fx + fw / 2 + k * fw * .26, fy + fh + 6 * U, fh * .62 * (real ? (i === 1 ? 1.08 : .95) : 1), cols[i], real ? eOutBack(seg(v, 1.1 + i * .06, 1.4 + i * .06)) : 1));
      if (!real) { ctx.save(); ctx.globalAlpha = .55; ctx.translate(fx + fw / 2, fy + fh * .45); ctx.rotate(-.35); text(ctx, "STOCK", 0, 0, fh * .26, P.cream, true); ctx.restore();
        const xq = seg(v, .45, .75); if (xq > 0) { line(ctx, fx + fw * .15, fy + fh * .15, lerp(fx + fw * .15, fx + fw * .85, Math.min(1, xq * 2)), lerp(fy + fh * .15, fy + fh * .85, Math.min(1, xq * 2)), P.r, LW * 2.4);
          if (xq > .5) line(ctx, fx + fw * .85, fy + fh * .15, lerp(fx + fw * .85, fx + fw * .15, (xq - .5) * 2), lerp(fy + fh * .15, fy + fh * .85, (xq - .5) * 2), P.r, LW * 2.4); } }
      ctx.restore(); ctx.restore();
      if (real) { const hq = eOutBack(seg(v, 1.35, 1.6)); if (hq > 0) heart(ctx, fx + fw * .86, fy + fh * .12, 70 * U * hq, P.r); }
    },
    door(ctx, v, x, y, w, h) { // a filing cabinet slides away, a front door swings open onto light
      const cq = eOutBack(seg(v, 0, .3)), cout = eInBack(seg(v, .6, .9));
      if (cout < 1) { const cw = h * .5, ch = h * .86, cx = x + w * .3 - cw / 2 - cout * w, cy = y + h * .07;
        ctx.save(); ctx.translate(cx + cw / 2, cy + ch); ctx.scale(cq, cq); ctx.translate(-cx - cw / 2, -cy - ch);
        box(ctx, cx, cy, cw, ch, 10 * U, P.cream, P.ink);
        [0, 1, 2].forEach(k => { const dy = cy + 14 * U + k * (ch - 28 * U) / 3, op = k === 1 ? Math.sin(seg(v, .2, .55) * Math.PI) * 30 * U : 0;
          box(ctx, cx + 12 * U + op, dy, cw - 24 * U, (ch - 28 * U) / 3 - 12 * U, 8 * U, P.y, P.ink);
          box(ctx, cx + cw / 2 - 26 * U + op, dy + ((ch - 28 * U) / 3 - 12 * U) / 2 - 7 * U, 52 * U, 14 * U, 7 * U, P.ink); });
        ctx.restore(); }
      const dq = eOutBack(seg(v, .75, 1.05)); if (dq <= 0) return;
      const dw = h * .5, dh = h * .9, dx = x + w * .5 - dw / 2, dy = y + h * .05;
      ctx.save(); ctx.translate(dx + dw / 2, dy + dh); ctx.scale(dq, dq); ctx.translate(-dx - dw / 2, -dy - dh);
      box(ctx, dx - 12 * U, dy - 12 * U, dw + 24 * U, dh + 12 * U, 14 * U, P.ink);
      box(ctx, dx, dy, dw, dh, 8 * U, P.y);
      const op = eOutExpo(seg(v, 1.1, 1.5)), ow = dw * (1 - op * .72);
      const lx = op > 0 ? seg(v, 1.2, 1.6) : 0;
      if (lx > 0) [-.5, -.2, .1, .4].forEach(a => line(ctx, dx + dw * .55, dy + dh * .5, dx + dw * .55 + Math.cos(a) * dw * (.4 + lx * .5), dy + dh * .5 + Math.sin(a) * dw * (.4 + lx * .5), P.cream, LW * .8));
      box(ctx, dx, dy, ow, dh, 8 * U, P.b, P.ink);
      shape(ctx, "circle", dx + ow - 22 * U, dy + dh * .55, 20 * U, 0, P.y, P.ink);
      ctx.restore();
    },
    timer(ctx, v, x, y, w, h) { // a stopwatch counts five seconds
      const r = h * .4, cx = x + w * .42, cy = y + h * .55, q = eOutBack(seg(v, 0, .3));
      ctx.save(); ctx.translate(cx, cy); ctx.scale(q, q);
      box(ctx, -18 * U, -r - 40 * U, 36 * U, 30 * U, 6 * U, P.ink); box(ctx, -40 * U, -r - 54 * U, 80 * U, 20 * U, 10 * U, P.ink);
      shape(ctx, "circle", 0, 0, r * 2, 0, P.cream, P.ink);
      const s = seg(v, .3, 2.3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r - 12 * U, -Math.PI / 2, -Math.PI / 2 + s * Math.PI * 2); ctx.closePath(); ctx.fillStyle = P.r; ctx.fill();
      shape(ctx, "circle", 0, 0, r * 1.05, 0, P.cream, P.ink);
      text(ctx, String(Math.max(0, 5 - Math.floor(s * 5))), 0, 4 * U, r * .62, P.ink);
      ctx.restore();
    },
    num(ctx, v, x, y, w, h, sc) { // a numbered question: big number, a question mark bobbing
      const n = (sc.data || {}).n || 1, q = eOutBack(seg(v, 0, .3)), cx = x + w * .4, cy = y + h * .52, r = h * .42;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((1 - q) * -.5); ctx.scale(q, q);
      shape(ctx, "circle", 0, 0, r * 2, 0, P.cream, P.ink); text(ctx, String(n), 0, 6 * U, r * 1.15, P.ink, true);
      ctx.restore();
      const m = eOutBack(seg(v, .25, .5)); if (m > 0) { ctx.save(); ctx.translate(cx + r * 1.25, cy - r * .8 + Math.sin(v * 6) * 8 * U); ctx.rotate(.2); ctx.scale(m, m);
        shape(ctx, "circle", 0, 0, 92 * U, 0, P.y, P.ink); text(ctx, "?", 0, 4 * U, 64 * U, P.ink); ctx.restore(); }
    },
    headline(ctx, v, x, y, w, h) { // the homepage, with one clear sentence highlighted at the top
      const bw = w * .86, bh = h * .86, bx = x + w * .05, by = y + h * .07, p = eOutBack(seg(v, 0, .28));
      ctx.save(); ctx.translate(bx + bw / 2, by + bh); ctx.scale(1, p); ctx.translate(-bx - bw / 2, -by - bh);
      browser(ctx, bx, by, bw, bh);
      const hl = eOutExpo(seg(v, .3, .7)); box(ctx, bx + 22 * U, by + 66 * U, (bw - 44 * U) * hl, 64 * U, 10 * U, P.y);
      [.82, .6].forEach((k, i) => box(ctx, bx + 34 * U, by + 82 * U + i * 30 * U, (bw - 80 * U) * k * eOutExpo(seg(v, .25 + i * .08, .5 + i * .08)), 13 * U, 6 * U, P.ink));
      [0, 1, 2].forEach(i => { const q = 1 - .7 * seg(v, .7, 1); box(ctx, bx + 34 * U, by + 158 * U + i * 26 * U, (bw - 80 * U) * (.7 - i * .15), 10 * U, 5 * U, P.ink); ctx.save(); ctx.globalAlpha = 1 - q; ctx.restore(); });
      ctx.restore();
    },
    people(ctx, v, x, y, w, h) { // a real photo of your people pops into the frame
      const fx = x + w * .08, fy = y + h * .08, fw = w * .8, fh = h * .84, q = eOutBack(seg(v, 0, .3));
      ctx.save(); ctx.translate(fx + fw / 2, fy + fh / 2); ctx.rotate((1 - q) * .3 - .03); ctx.scale(q, q); ctx.translate(-fx - fw / 2, -fy - fh / 2);
      box(ctx, fx - 14 * U, fy - 14 * U, fw + 28 * U, fh + 28 * U, 10 * U, P.cream, P.ink);
      box(ctx, fx, fy, fw, fh, 6 * U, P.b, P.ink);
      ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, fw, fh); ctx.clip();
      shape(ctx, "circle", fx + fw * .8, fy + fh * .25, fh * .3, 0, P.y);
      [[-.28, P.r, .9], [0, P.g, 1.05], [.28, P.y, .85]].forEach(([k, c, s], i) => person(ctx, fx + fw / 2 + k * fw, fy + fh + 4 * U, fh * .6 * s, c, eOutBack(seg(v, .2 + i * .08, .45 + i * .08))));
      ctx.restore(); ctx.restore();
    },
    button(ctx, v, x, y, w, h, sc) { // one button: its word cycles (Donate, Join, Volunteer), then a tap
      const words = (sc.data || {}).words || ["Donate"], q = eOutBack(seg(v, 0, .3));
      const bw = w * .78, bh = h * .38, cx = x + w * .46, cy = y + h * .5;
      const at = (sc.data || {}).at || words.map((_, i) => .3 + .5 * i), last = at[at.length - 1] + .5;  // data.at_w: each word as it's said
      const k = Math.max(0, at.filter(a => v >= a).length - 1);
      const press = 1 - .08 * Math.sin(seg(v, last, last + .2) * Math.PI);
      ctx.save(); ctx.translate(cx, cy); ctx.scale(q * press, q * press);
      box(ctx, -bw / 2 + 10 * U, -bh / 2 + 12 * U, bw, bh, bh / 2, P.ink);
      box(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, [P.r, P.y, P.g][k % 3], P.ink);
      text(ctx, words[k], 0, 4 * U, bh * .44, k % 3 === 1 ? P.ink : P.cream);
      ctx.restore();
      const pq = eOutExpo(seg(v, last - .3, last)); if (pq > 0) {
        ctx.save(); ctx.translate(lerp(cx + bw * .7, cx + bw * .25, pq), lerp(cy + bh * 1.3, cy + bh * .2, pq)); ctx.rotate(-.5); shape(ctx, "triangle", 0, 0, 52 * U, 0, P.cream, P.ink); ctx.restore(); }
    },
    sticky(ctx, v, x, y, w, h) { // sticky notes slap onto the wall, a page name scribbled on each
      [[P.y, .06, .1, -.08], [P.r, .38, .2, .06], [P.b, .7, .06, -.04], [P.g, .22, .52, .1], [P.y, .55, .55, -.07]].forEach(([c, kx, ky, rot], i) => {
        const q = eOutBack(seg(v, i * .14, .25 + i * .14)); if (q <= 0) return;
        const s = h * .4, nx = x + w * kx + s / 2, ny = y + h * ky + s / 2;
        ctx.save(); ctx.translate(nx, ny); ctx.rotate(rot); const z = 1 + 1.2 * (1 - q); ctx.scale(z, z); ctx.globalAlpha = Math.min(1, q * 2);
        box(ctx, -s / 2, -s / 2, s, s, 4 * U, c, P.ink);
        const wq = seg(v, .3 + i * .14, .7 + i * .14);
        [-.15, .1].forEach((k, j) => { const lw = s * .62 * Math.min(1, Math.max(0, wq * 2 - j)); if (lw > 0) line(ctx, -s * .31, s * k, -s * .31 + lw, s * k, P.ink, LW * .7); });
        ctx.restore();
      });
    },
    nav(ctx, v, x, y, w, h, sc) { // the new menu: about five items appear one by one, the last one a button
      const items = (sc.data || {}).items || ["About", "Programs", "Events", "Get involved", "Donate"];
      const times = (sc.data || {}).at || items.map((_, i) => .15 + i * .3);
      const px = x + w * .05, py = y + h * .03, pw = w * .9, ph = h * .94, rh = (ph - 30 * U) / items.length;
      box(ctx, px, py, pw, ph, 16 * U, P.cream, P.ink);
      items.forEach((it, i) => { const q = eOutBack(seg(v, times[i], times[i] + .25)); if (q <= 0) return;
        const ry = py + 15 * U + i * rh, last = i === items.length - 1;
        ctx.save(); ctx.translate(px + pw / 2, ry + rh / 2); ctx.scale(q, q);
        if (last) { box(ctx, -pw * .4, -rh * .4, pw * .8, rh * .8, rh * .4, P.r, P.ink); text(ctx, it, 0, 3 * U, rh * .56, P.cream); }
        else { shape(ctx, "circle", -pw * .36, 0, rh * .32, 0, [P.b, P.y, P.g, P.r][i % 4], P.ink); text(ctx, it, -pw * .27, 3 * U, rh * .62, P.ink, false, "left"); }
        ctx.restore(); });
    },
    trash(ctx, v, x, y, w, h) { // leftover pages fall into the archive bin
      bin(ctx, x + w * .5 - h * .25, y + h * .4, h * .5, h * .56, eOutBack(seg(v, .05, .3)) * (1 - seg(v, 1, 1.2)));
      [P.y, P.r, P.b].forEach((c, i) => { const q = seg(v, .2 + i * .15, .75 + i * .15); if (q <= 0 || q >= 1) return;
        const s = h * .26, nx = x + w * (.2 + i * .3), ny = y + h * .02;
        ctx.save(); ctx.translate(lerp(nx, x + w * .5, eInExpo(q)), lerp(ny, y + h * .5, eInExpo(q))); ctx.rotate(q * (i - 1) * 2); ctx.scale(1 - q * .5, 1 - q * .5);
        box(ctx, -s / 2, -s / 2, s, s, 4 * U, c, P.ink); ctx.restore(); });
    },
    peek(ctx, v, x, y, w, h) { // curtains open on the messy middle: sketches, a scribble, a coffee ring
      const fx = x + w * .06, fy = y + h * .06, fw = w * .84, fh = h * .88, q = eOutBack(seg(v, 0, .25));
      ctx.save(); ctx.translate(fx + fw / 2, fy + fh / 2); ctx.scale(q, q); ctx.translate(-fx - fw / 2, -fy - fh / 2);
      box(ctx, fx, fy, fw, fh, 12 * U, P.cream, P.ink);
      ctx.save(); ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 12 * U); ctx.clip();
      [["square", P.b, .25, .35, .2], ["circle", P.y, .55, .3, .18], ["triangle", P.g, .75, .62, .22], ["circle", P.r, .3, .72, .12]].forEach(([k, c, kx, ky, ks], i) =>
        shape(ctx, k, fx + fw * kx, fy + fh * ky, fh * ks * eOutBack(seg(v, .45 + i * .07, .7 + i * .07)), i * .4, c, P.ink));
      const sq = seg(v, .6, 1.1); if (sq > 0) { ctx.beginPath(); for (let k = 0; k <= 40 * sq; k++) { const xx = fx + fw * (.42 + k / 40 * .4), yy = fy + fh * (.82 + Math.sin(k * .9) * .05); k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.lineWidth = LW * .7; ctx.strokeStyle = P.ink; ctx.stroke(); }
      const o = eIO(seg(v, .2, .6));
      box(ctx, fx - 10 * U, fy - 10 * U, fw * .5 * (1 - o) + 10 * U, fh + 20 * U, 0, P.r, P.ink);
      box(ctx, fx + fw * (.5 + .5 * o), fy - 10 * U, fw * .5 * (1 - o) + 10 * U, fh + 20 * U, 0, P.r, P.ink);
      ctx.restore(); ctx.restore();
    },
    belong(ctx, v, x, y, w, h) { // a circle of people, and one more joins it
      const cx = x + w * .45, cy = y + h * .55, R = h * .3, n = 5;
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / (n + 1), q = eOutBack(seg(v, i * .06, .3 + i * .06));
        person(ctx, cx + Math.cos(a) * R, cy + Math.sin(a) * R * .8 + h * .14, h * .3, [P.b, P.g, P.r, P.b, P.g][i], q); }
      const a = -Math.PI / 2 + n * Math.PI * 2 / (n + 1), j = eOutBack(seg(v, .55, .95));
      person(ctx, lerp(x + w * 1.1, cx + Math.cos(a) * R, j), cy + Math.sin(a) * R * .8 + h * .14, h * .3, P.y, Math.max(.01, Math.min(1, seg(v, .5, .6) * 10)));
      const hq = eOutBack(seg(v, 1, 1.3)); if (hq > 0) heart(ctx, cx, cy - h * .05, 90 * U * hq * (1 + .06 * Math.sin(v * 10)), P.r);
    },
    tuesday(ctx, v, x, y, w, h) { // a calendar page for a random Tuesday, a mug of coffee steaming
      const cw = h * .66, ch = h * .82, cx = x + w * .08, cy = y + h * .1, q = eOutBack(seg(v, 0, .3));
      ctx.save(); ctx.translate(cx + cw / 2, cy); ctx.rotate((1 - q) * .4 - .05); ctx.scale(q, q); ctx.translate(-cx - cw / 2, -cy);
      box(ctx, cx, cy, cw, ch, 14 * U, P.cream, P.ink); box(ctx, cx, cy, cw, ch * .3, 14 * U, P.r, P.ink);
      text(ctx, "TUE", cx + cw / 2, cy + ch * .16, ch * .17, P.cream); text(ctx, "8:14", cx + cw / 2, cy + ch * .64, ch * .3, P.ink, true);
      ctx.restore();
      const mq = eOutBack(seg(v, .3, .55)); if (mq <= 0) return;
      const mx = x + w * .72, my = y + h * .62, mw = h * .36, mh = h * .36;
      ctx.save(); ctx.translate(mx, my); ctx.scale(mq, mq);
      ctx.beginPath(); ctx.arc(mw / 2, 0, mh * .22, -Math.PI / 2, Math.PI / 2); ctx.lineWidth = LW * 1.6; ctx.strokeStyle = P.ink; ctx.stroke();
      box(ctx, -mw / 2, -mh / 2, mw, mh, 14 * U, P.b, P.ink);
      [-.2, 0, .2].forEach((k, i) => { const s = seg(v, .5 + i * .1, 1.5 + i * .1); if (s <= 0) return; ctx.save(); ctx.globalAlpha = 1 - s;
        ctx.beginPath(); for (let j = 0; j <= 10; j++) { const yy = -mh / 2 - 10 * U - j * 7 * U - s * 40 * U, xx = mw * k + Math.sin(j * .8 + v * 6) * 8 * U; j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
        ctx.lineWidth = LW * .6; ctx.strokeStyle = P.ink; ctx.stroke(); ctx.restore(); });
      ctx.restore();
    },
    friends(ctx, v, x, y, w, h) { // friends arrive from both sides, hearts float up
      [[-.32, P.r, -1], [0, P.b, 0], [.32, P.g, 1]].forEach(([k, c, side], i) => { const q = eOutBack(seg(v, i * .12, .4 + i * .12));
        person(ctx, lerp(x + w * (.5 + side * .9), x + w * (.5 + k), Math.min(q, 1)), y + h * .98, h * .62, c, q > 0 ? 1 : 0); });
      for (let i = 0; i < 4; i++) { const q = seg(v, .6 + i * .15, 1.4 + i * .15); if (q <= 0 || q >= 1) continue;
        ctx.save(); ctx.globalAlpha = 1 - eInExpo(q); heart(ctx, x + w * (.25 + i * .17), y + h * .55 - eOutExpo(q) * h * .5, 50 * U, [P.r, P.y][i % 2]); ctx.restore(); }
    },
  });
  function heart(ctx, x, y, s, col) {
    ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.moveTo(0, s * .35);
    ctx.bezierCurveTo(-s * .7, -s * .1, -s * .35, -s * .6, 0, -s * .25); ctx.bezierCurveTo(s * .35, -s * .6, s * .7, -s * .1, 0, s * .35);
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = LW * .8; ctx.lineJoin = "round"; ctx.strokeStyle = P.ink; ctx.stroke(); ctx.restore();
  }
  Object.assign(FIELD, { pdfs: "y", menu: "b", stock: "g", door: "r", timer: "y", num: "b", headline: "g", people: "r", button: "b", sticky: "g", nav: "y", trash: "r", peek: "y", belong: "b", tuesday: "g", friends: "y" });

  function scene(ctx, sc, t) {
    const v = t - sc.t, outv = seg(t, sc.end - .25, sc.end);
    if (v < 0 || outv >= 1) return false;
    const pw = W * (TALL ? .88 : .92), ph = H * (TALL ? .27 : .3), px0 = (W - pw) / 2, py = H * (TALL ? .05 : .03);
    const px = px0 + (1 - eOutExpo(seg(v, 0, .28))) * -W + eInExpo(outv) * W;
    const fk = FIELD[sc.kind] || "r", field = P[fk];
    ctx.save(); box(ctx, px, py, pw, ph, 22 * U, field, P.ink);
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 22 * U); ctx.clip();
    (ill[sc.kind] || ill.brand)(ctx, v, px + pw * .02, py + ph * .06, pw * .62, ph * .88, sc);
    const ls = String(sc.label || "").split("\n"), lsz = ph * (ls.length > 1 ? .17 : .24);
    ls.forEach((l, i) => label(ctx, l, px + pw * .62, py + ph * .5 + (i - (ls.length - 1) / 2) * lsz * 1.12, lsz, fk === "y" ? P.ink : P.cream, eOutExpo(seg(v, .25 + i * .08, .55 + i * .08)), pw * .35));
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
