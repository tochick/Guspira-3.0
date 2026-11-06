// Empaqueta la web en un único HTML de demostración (sin servidor) para verla desde cualquier dispositivo.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dataUri = (p, type) => `data:${type};base64,${fs.readFileSync(path.join(root, p)).toString('base64')}`;
const logo = dataUri('public/logo.webp', 'image/webp');
const symbol = dataUri('public/logo-symbol.webp', 'image/webp');
const text = dataUri('public/logo-text.webp', 'image/webp');
const icon = dataUri('public/favicon.png', 'image/png');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const body = read('public/index.html').match(/<body>([\s\S]*?)<script/)[1]
  .replace(/src="\/favicon\.png"/g, `src="${icon}"`)
  .replace(/src="\/logo\.webp"/g, 'data-asset="logo" src="data:,"');

const banner = `<div class="demo-banner" role="note"><span><strong>Demostración.</strong> Los datos se guardan solo en este navegador y Spotify está simulado. Panel: candado arriba a la derecha o «Área privada» al pie, contraseña <code>guspira2026</code> · Código del babyshower: <code>BEBE</code> · Los datos de contacto son de ejemplo</span><a href="/admin" data-link class="btn small">Entrar al panel</a><button type="button" class="link-btn" id="demo-reset">Reiniciar datos</button></div>`;

const css = read('public/styles.css') + `
.demo-banner { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: center; padding: 8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px)); background: #241c0e; border-bottom: 1px solid var(--line); color: #f1dfb6; font-size: 12.5px; text-align: center; }
.demo-banner code { font-size: 12px; white-space: nowrap; }
`;

const html = `<title>Guspira Events</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#0b0906">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Josefin+Sans:wght@300;400;600&family=Montserrat:wght@400;500;600&display=swap">
<style>
${css}
</style>
${banner}
${body}
<script>window.GUSPIRA_ASSETS = { logo: ${JSON.stringify(logo)}, icon: ${JSON.stringify(icon)}, symbol: ${JSON.stringify(symbol)}, text: ${JSON.stringify(text)} };</script>
<script>${safe(read('public/vendor/qrcode.js'))}</script>
<script>${safe(read('public/pyro-calc.js'))}</script>
<script>(function(){ var module = { exports: {} }; ${safe(read('lib/defaults.cjs'))}
window.GuspiraDefaults = module.exports; })();</script>
<script>${safe(read('demo/demo-api.js'))}</script>
<script>${safe(read('public/app.js'))}</script>
<script>document.getElementById('demo-reset').addEventListener('click', function () { window.GuspiraDemoReset(); location.reload(); });</script>
`;
const out = path.join(root, 'demo', 'guspira-demo.html');
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)} KB)`);

// Versión como página completa para publicarla en GitHub Pages (enlace público para el móvil).
const siteDir = path.join(root, 'demo', 'site');
fs.mkdirSync(siteDir, { recursive: true });
const cut = html.indexOf('</style>') + '</style>'.length;
const headPart = html.slice(0, cut);
const bodyPart = html.slice(cut);
const page = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Guspira Events: peticiones de canciones con Spotify y presupuestos de pirotecnia para bodas y celebraciones (demostración).">
<link rel="icon" href="${icon}">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);color-scheme:dark}body{margin:0;background:#0b0906}[hidden]{display:none!important}</style>
${headPart}
</head>
<body>
${bodyPart}
</body>
</html>
`;
fs.writeFileSync(path.join(siteDir, 'index.html'), page);
fs.copyFileSync(path.join(root, 'public', 'apple-touch-icon.png'), path.join(siteDir, 'apple-touch-icon.png'));
fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
console.log(`${path.join(siteDir, 'index.html')} (página completa para GitHub Pages)`);
