/* Flat mockups for the sketch-to-guide scene (Needlework Guild). Drawn shapes only, no stock photos,
   no outlines: a tee, a hanging sign, a sticker sheet, the app, a tote, an embroidery hoop, a name badge
   and business cards. Each returns an SVG string 1080x1920. Uses the #M symbol (the guild mark) with
   --t (thread color) and --n (needle color). Copy comes from the guild's real site and voice. */
window.MOCKUPS = (function () {
  const C = { sage: '#3E5538', mid: '#5C7A52', pale: '#EEF3EC', rose: '#B87260', prose: '#F5EBE7', cream: '#FAF7F2', linen: '#F0EAE0', hair: '#DDD5C8', ink: '#242424', deep: '#A0604F' };
  const mark = (x, y, w, t, n, rot = 0) => `<use href="#M" x="${x}" y="${y}" width="${w}" height="${w * 39 / 37}" style="--t:${t};--n:${n}" transform="rotate(${rot} ${x + w / 2} ${y + w * 0.53})"/>`;
  const head = (x, y, size, fill, s, anchor = 'middle', style = 'normal') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Cormorant Garamond" font-weight="500" font-style="${style}" font-size="${size}" fill="${fill}">${s}</text>`;
  const small = (x, y, size, fill, s, ls = 6, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="DM Sans" font-weight="500" font-size="${size}" letter-spacing="${ls}" fill="${fill}">${s}</text>`;
  const svg = (bg, body) => `<svg class="mock" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="${bg}"/>${body}</svg>`;

  return [
    // 1. tee: sage shirt, cream mark on the chest
    () => svg(C.pale, `
      <path d="M380 470 L300 500 L130 640 L230 820 L320 760 L320 1480 Q540 1510 760 1480 L760 760 L850 820 L950 640 L780 500 L700 470 Q540 560 380 470 Z" fill="${C.sage}"/>
      <path d="M380 470 Q540 560 700 470 L670 462 Q540 530 410 462 Z" fill="${C.mid}"/>
      <path d="M230 820 L320 760 L320 790 L245 845 Z M850 820 L760 760 L760 790 L835 845 Z" fill="${C.mid}"/>
      ${mark(470, 720, 140, C.prose, C.cream)}
      ${small(540, 930, 26, C.cream, 'NEEDLEWORK GUILD', 7)}`),
    // 2. hanging blade sign on a linen wall
    () => svg(C.linen, `
      <rect x="150" y="560" width="560" height="26" rx="6" fill="${C.ink}"/>
      <rect x="150" y="530" width="26" height="90" rx="6" fill="${C.ink}"/>
      <rect x="300" y="586" width="6" height="150" fill="${C.ink}"/><rect x="600" y="586" width="6" height="150" fill="${C.ink}"/>
      <circle cx="453" cy="1010" r="290" fill="${C.sage}"/>
      ${mark(373, 840, 160, C.rose, C.cream)}
      ${head(453, 1110, 58, C.cream, 'Needlework Guild')}
      ${small(453, 1160, 22, C.prose, 'OF MINNESOTA', 6)}
      <rect x="760" y="300" width="320" height="1100" fill="${C.hair}"/>
      <rect x="800" y="360" width="240" height="420" fill="${C.cream}"/><rect x="800" y="830" width="240" height="420" fill="${C.cream}"/>`),
    // 3. sticker sheet
    () => svg(C.rose, `
      <g transform="rotate(-6 540 960)">
        <rect x="160" y="420" width="760" height="1080" rx="28" fill="${C.cream}"/>
        <circle cx="380" cy="660" r="160" fill="${C.sage}"/>${mark(310, 580, 140, C.prose, C.cream)}
        <rect x="560" y="560" width="300" height="200" rx="100" fill="${C.prose}"/>${head(710, 680, 54, C.sage, 'Stitch <tspan font-style="italic" fill="${C.rose}">with</tspan> us')}
        <rect x="230" y="900" width="620" height="170" rx="85" fill="${C.sage}"/>${head(540, 1005, 70, C.cream, 'Find <tspan font-style="italic" fill="${C.prose}">your</tspan> group')}
        <circle cx="330" cy="1290" r="130" fill="${C.prose}"/>${mark(272, 1222, 116, C.rose, C.sage)}
        <rect x="520" y="1170" width="320" height="240" rx="30" fill="${C.mid}"/>${head(680, 1330, 120, C.cream, 'MN')}
      </g>`),
    // 4. the app on a phone
    () => svg(C.sage, `
      <rect x="250" y="300" width="580" height="1240" rx="80" fill="${C.ink}"/>
      <rect x="278" y="328" width="524" height="1184" rx="58" fill="${C.cream}"/>
      <rect x="470" y="350" width="140" height="34" rx="17" fill="${C.ink}"/>
      ${mark(310, 430, 54, C.rose, C.sage)}${small(380, 470, 18, C.sage, 'NEEDLEWORK GUILD', 3, 'start')}
      ${head(310, 610, 76, C.ink, 'Find <tspan font-style="italic" fill="${C.rose}">your</tspan>', 'start')}${head(310, 690, 76, C.ink, 'group', 'start')}
      ${[0, 1, 2].map(i => `<rect x="310" y="${750 + i * 190}" width="460" height="160" rx="22" fill="${i === 0 ? C.sage : C.pale}"/>
        <rect x="334" y="${774 + i * 190}" width="96" height="112" rx="16" fill="${i === 0 ? C.cream : C.cream}"/>
        ${i === 0 ? small(382, 812, 18, C.rose, 'NOV', 2) + head(382, 864, 48, C.ink, '21') : mark(352, 794 + i * 190, 60, C.rose, C.sage)}
        ${head(456, 818 + i * 190, 34, i === 0 ? C.cream : C.ink, ['Come and stitch', 'Monthly meeting', 'Retreat'][i], 'start')}
        ${small(456, 862 + i * 190, 18, i === 0 ? C.prose : C.mid, ['ALL LEVELS WELCOME', 'GUESTS WELCOME', 'STITCH TOGETHER'][i], 2, 'start')}`).join('')}
      <rect x="310" y="1340" width="460" height="96" rx="48" fill="${C.rose}"/>${small(540, 1398, 24, C.cream, 'JOIN THE GUILD', 4)}`),
    // 5. tote bag
    () => svg(C.cream, `
      <path d="M400 640 Q400 380 540 380 Q680 380 680 640" fill="none" stroke="${C.hair}" stroke-width="34"/>
      <rect x="250" y="620" width="580" height="760" rx="10" fill="#E6DCCB"/>
      ${mark(470, 820, 140, C.rose, C.sage)}
      ${head(540, 1080, 66, C.sage, 'Needlework Guild')}
      ${small(540, 1140, 24, C.rose, 'OF MINNESOTA', 7)}`),
    // 6. embroidery hoop, the mark in running stitch
    () => svg(C.sage, `
      <circle cx="540" cy="960" r="400" fill="#C9A27A"/><circle cx="540" cy="960" r="372" fill="#B48A60"/>
      <circle cx="540" cy="960" r="356" fill="${C.cream}"/>
      <rect x="505" y="520" width="70" height="60" rx="10" fill="#B48A60"/><rect x="520" y="480" width="40" height="60" rx="8" fill="#9C7650"/>
      <g transform="translate(540 960) scale(15) translate(-14.5 -17)">
        <use href="#thread" fill="none" stroke="${C.rose}" stroke-width="0.62" stroke-linecap="round" stroke-dasharray="1.1 0.7"/>
        <use href="#needle" fill="${C.sage}"/>
      </g>`),
    // 7. name badge on a lanyard
    () => svg(C.pale, `
      <path d="M430 0 L500 760 L580 760 L650 0 L600 0 L540 700 L480 0 Z" fill="${C.rose}"/>
      <rect x="500" y="740" width="80" height="70" rx="10" fill="${C.hair}"/>
      <rect x="290" y="800" width="500" height="660" rx="34" fill="${C.cream}"/>
      <rect x="290" y="800" width="500" height="200" rx="34" fill="${C.sage}"/><rect x="290" y="950" width="500" height="50" fill="${C.sage}"/>
      ${mark(340, 840, 110, C.prose, C.cream)}${small(470, 905, 22, C.cream, 'HELLO, I STITCH', 3, 'start')}
      ${head(540, 1210, 96, C.ink, 'Your name')}
      ${small(540, 1290, 24, C.rose, 'MEMBER', 8)}`),
    // 8. business cards
    () => svg(C.linen, `
      <g transform="rotate(-8 540 820)"><rect x="200" y="560" width="680" height="400" rx="18" fill="${C.sage}"/>${mark(470, 650, 140, C.rose, C.cream)}${small(540, 900, 22, C.prose, 'NEEDLEWORK GUILD OF MINNESOTA', 4)}</g>
      <g transform="rotate(5 540 1260)"><rect x="200" y="1060" width="680" height="400" rx="18" fill="${C.cream}"/>
        ${head(260, 1180, 58, C.ink, 'Find <tspan font-style="italic" fill="${C.rose}">your</tspan> group', 'start')}
        ${small(260, 1250, 22, C.mid, 'COME AND STITCH WITH US', 3, 'start')}
        ${small(260, 1400, 24, C.sage, 'needleworkguildmn.org', 1, 'start')}${mark(760, 1330, 80, C.rose, C.sage)}</g>`),
  ];
})();
