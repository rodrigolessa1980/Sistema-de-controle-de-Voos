import fs from 'fs';
const read = p => fs.readFileSync(p, 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const react = read('node_modules/react/umd/react.production.min.js');
const reactDom = read('node_modules/react-dom/umd/react-dom.production.min.js');
const lucide = read('node_modules/lucide/dist/umd/lucide.js');
const app = read('app.compiled.js');
const tw = read('tw.css');

const customCss = `
html,body{background:#F7F9FC}
*{-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:999px}
::-webkit-scrollbar-track{background:transparent}
.fade-in{animation:fade .18s ease-out}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
select{-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7688' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .6rem center;padding-right:2rem}
[data-help]{position:relative;cursor:help}
`;

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Air Charter Manager</title>
<style>
${tw}
${customCss}
</style>
</head>
<body class="font-sans text-ink">
<div id="root"></div>
<script>${safe(react)}</script>
<script>${safe(reactDom)}</script>
<script>${safe(lucide)}</script>
<script>
// Lucide UMD (browser) exposes window.lucide with .icons — normalize just in case
if (!window.lucide && typeof lucide !== 'undefined') window.lucide = lucide;
</script>
<script>${safe(app)}</script>
</body>
</html>`;

fs.writeFileSync('air-charter-manager.html', html);
console.log('written air-charter-manager.html:', html.length, 'bytes');
