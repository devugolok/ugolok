import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'dist';
const CORAL = '#DE6B3E';
const CORAL_DARK = '#F0895C';
const CREAM = '#FBEEDC';
const NIGHT = '#1E1916';

// Знак «Г»: пузырь с одним острым углом (нижний левый) и сердце-вырез в этом углу.
// Сетка 32×32. Сердце — второй подконтур, вырезается правилом evenodd.
const BUBBLE = 'M4 26V11a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6Z';
const HEART = 'M11.5 22.6 7.78 18.9A2.76 2.76 0 0 1 11.5 15.18a2.76 2.76 0 0 1 3.72 3.72Z';
const MARK = `${BUBBLE}${HEART}`;

const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(OUT, p)), { recursive: true }); fs.writeFileSync(path.join(OUT, p), s); };
const png = (svg, size, p) => {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { fontFiles: fs.readdirSync('fonts').map(f => 'fonts/' + f), loadSystemFonts: false, defaultFontFamily: 'Golos Text' },
  });
  w(p, r.render().asPng());
};

// Знак на прозрачном фоне. scale/offset задают место знака внутри квадрата view×view.
const markSvg = ({ view = 32, scale = 1, fill = CORAL, bg = null, rx = 0 }) => {
  const t = (view - 32 * scale) / 2;
  const bgEl = bg ? `<rect width="${view}" height="${view}" rx="${rx}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}">${bgEl}<path transform="translate(${t} ${t + 0.5 * scale}) scale(${scale})" fill="${fill}" fill-rule="evenodd" d="${MARK}"/></svg>`;
};

// ---------- brand/ : исходники ----------
w('brand/ugolok-mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><path fill="${CORAL}" fill-rule="evenodd" d="${MARK}"/></svg>\n`);
w('brand/ugolok-mark-mono.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="${MARK}"/></svg>\n`);
const appIcon = markSvg({ view: 1024, scale: 22, fill: CREAM, bg: CORAL, rx: 230 }).replace(`fill="${CREAM}" fill-rule="evenodd"`, `fill="${CREAM}" fill-rule="evenodd"`);
w('brand/ugolok-app-icon.svg', appIcon + '\n');
png(appIcon, 1024, 'brand/ugolok-app-icon-1024.png');

// ---------- web/ ----------
w('web/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>path{fill:${CORAL}}@media (prefers-color-scheme:dark){path{fill:${CORAL_DARK}}}</style><path fill-rule="evenodd" d="${MARK}"/></svg>\n`);
// мелкие размеры: знак крупнее (почти во весь квадрат), чтобы сердце не слиплось
for (const s of [16, 32, 48]) png(markSvg({ scale: 1.25 }), s, `tmp/fav-${s}.png`);
png(markSvg({ scale: 1.25 }), 96, 'web/favicon-96x96.png');
// apple-touch-icon: без прозрачности, iOS сам скругляет углы
png(markSvg({ view: 180, scale: 4.1, fill: CREAM, bg: CORAL }), 180, 'web/apple-touch-icon.png');
// PWA «any»: плитка со скруглением, вне плитки прозрачно
const tile = markSvg({ view: 512, scale: 11, fill: CREAM, bg: CORAL, rx: 115 });
png(tile, 192, 'web/web-app-manifest-192x192.png');
png(tile, 512, 'web/web-app-manifest-512x512.png');
// PWA «maskable»: фон во весь квадрат, знак внутри безопасного круга (80%)
png(markSvg({ view: 512, scale: 9.2, fill: CREAM, bg: CORAL }), 512, 'web/web-app-manifest-maskable-512x512.png');
png(markSvg({ view: 512, scale: 9.2, fill: CREAM, bg: CORAL }), 192, 'web/web-app-manifest-maskable-192x192.png');
// PWA «monochrome»: только силуэт, цвет подставит система (Android themed icons)
png(markSvg({ view: 512, scale: 9.2, fill: '#FFFFFF' }), 512, 'web/web-app-manifest-monochrome-512x512.png');

// карточка для соцсетей и мессенджеров
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><radialGradient id="lamp" cx="0" cy="630" r="760" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${CORAL}" stop-opacity=".42"/><stop offset=".55" stop-color="${CORAL}" stop-opacity=".08"/><stop offset="1" stop-color="${CORAL}" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="${NIGHT}"/><rect width="1200" height="630" fill="url(#lamp)"/>
<path transform="translate(96 168) scale(9.4)" fill="${CORAL}" fill-rule="evenodd" d="${MARK}"/>
<g font-family="Golos Text" fill="${CREAM}">
<text x="452" y="268" font-size="112" font-weight="600" letter-spacing="-2">Уголок</text>
<text x="456" y="342" font-size="38" font-weight="500" fill-opacity=".86">Уютный мессенджер, который</text>
<text x="456" y="392" font-size="38" font-weight="500" fill-opacity=".86">живёт на вашем сервере</text>
<text x="456" y="470" font-size="25" font-weight="500" fill="${CORAL_DARK}">Сквозное шифрование · Nostr · без номера телефона</text>
<text x="1104" y="574" font-size="26" font-weight="500" text-anchor="end" fill-opacity=".55">ugolok.tech</text>
</g></svg>`;
w('brand/og-image.svg', og);
png(og, 1200, 'web/og-image.png');

// ---------- desktop/ (Tauri / Electron) ----------
for (const s of [32, 128, 256]) png(appIcon, s, `desktop/${s}x${s}.png`);
png(appIcon, 256, 'desktop/128x128@2x.png');
png(appIcon, 1024, 'desktop/icon.png');
for (const s of [16, 24, 48, 64, 512]) png(appIcon, s, `tmp/app-${s}.png`);

// ---------- android/ (Capacitor: android/app/src/main/res) ----------
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const legacy = markSvg({ view: 48, scale: 1.05, fill: CREAM, bg: CORAL, rx: 10 });
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="24" fill="${CORAL}"/><path transform="translate(8.8 9.3) scale(0.95)" fill="${CREAM}" fill-rule="evenodd" d="${MARK}"/></svg>`;
const fg108 = markSvg({ view: 108, scale: 1.85, fill: CREAM });
for (const [d, k] of Object.entries(dens)) {
  png(legacy, 48 * k, `android/res/mipmap-${d}/ic_launcher.png`);
  png(round, 48 * k, `android/res/mipmap-${d}/ic_launcher_round.png`);
  png(fg108, 108 * k, `android/res/mipmap-${d}/ic_launcher_foreground.png`);
}
// Векторные слои adaptive icon: тот же контур, сетка 108dp, безопасная зона 66dp
const t = (108 - 32 * 1.85) / 2;
const vec = color => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:translateX="${t.toFixed(2)}" android:translateY="${(t + 0.925).toFixed(3)}" android:scaleX="1.85" android:scaleY="1.85">
        <path android:fillColor="${color}" android:fillType="evenOdd"
            android:pathData="${MARK}"/>
    </group>
</vector>
`;
w('android/res/drawable/ic_launcher_foreground.xml', vec(CREAM));
w('android/res/drawable/ic_launcher_monochrome.xml', vec('#FFFFFFFF'));
w('android/res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${CORAL}</color>\n</resources>\n`);
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
`;
w('android/res/mipmap-anydpi-v26/ic_launcher.xml', adaptive);
w('android/res/mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);
png(markSvg({ view: 512, scale: 11, fill: CREAM, bg: CORAL }), 512, 'android/store-icon-512.png');

// превью для проверки глазами
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="420" viewBox="0 0 1240 420"><rect width="1240" height="420" fill="#ECE7E1"/><rect x="620" width="620" height="420" fill="#2A2421"/>
${[16, 24, 32, 48, 64].map((s, i) => `<g transform="translate(${40 + i * 80} 40)"><svg width="${s}" height="${s}" viewBox="0 0 32 32"><path fill="${CORAL}" fill-rule="evenodd" d="${MARK}"/></svg></g><g transform="translate(${660 + i * 80} 40)"><svg width="${s}" height="${s}" viewBox="0 0 32 32"><path fill="${CORAL_DARK}" fill-rule="evenodd" d="${MARK}"/></svg></g>`).join('')}
<g transform="translate(40 160)"><svg width="200" height="200" viewBox="0 0 1024 1024">${appIcon.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></g>
<g transform="translate(280 160)"><svg width="200" height="200" viewBox="0 0 512 512"><clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#c)">${markSvg({ view: 512, scale: 9.2, fill: CREAM, bg: CORAL }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg></g>
<g transform="translate(700 160)"><svg width="200" height="200" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="#4A3F39"/>${markSvg({ view: 512, scale: 9.2, fill: '#E9DCCF' }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></g>
</svg>`;
png(sheet, 1240, 'tmp/preview.png');
console.log('ok');
