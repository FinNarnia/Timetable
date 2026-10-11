#!/usr/bin/env node
// Проверка опубликованного сайта после загрузки: адрес открывается, заголовки безопасности на месте (п. 15.1),
// прямые ссылки отдают приложение, скрипт с хешем доступен. Использование: node deploy/check-live.mjs https://fin-narnia.online/timetable/
const base = process.argv[2] ?? 'https://fin-narnia.online/timetable/';
const problems = [];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
  return { res, text: await res.text() };
}

const home = await get(base);
if (home.res.status !== 200) problems.push(`${base}: статус ${home.res.status}`);
const csp = home.res.headers.get('content-security-policy') ?? '';
if (!csp.includes("script-src 'self'")) problems.push('нет заголовка Content-Security-Policy — .htaccess не применился (п. 15.1)');
if (csp.includes('unsafe-inline')) problems.push('CSP разрешает unsafe-inline');
if (home.res.headers.get('x-content-type-options') !== 'nosniff') problems.push('нет X-Content-Type-Options: nosniff');
if (!home.text.includes('<div id="root">')) problems.push('главная страница — не приложение «Мой ритм»');

const deep = await get(new URL('reports', base).href);
if (deep.res.status !== 200 || !deep.text.includes('<div id="root">')) problems.push(`прямая ссылка /reports: статус ${deep.res.status} — нет перенаправления на index.html`);

const script = home.text.match(/src="([^"]+\.js)"/)?.[1];
if (!script) problems.push('в index.html нет скрипта');
else {
  const js = await fetch(new URL(script, base));
  if (js.status !== 200) problems.push(`${script}: статус ${js.status}`);
  if (!(js.headers.get('content-type') ?? '').includes('javascript')) problems.push(`${script}: тип ${js.headers.get('content-type')}`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
if (!base.startsWith('https:')) console.warn('Адрес не HTTPS — для хостинга обязателен HTTPS (п. 15.1).');
console.log(`Сайт ${base} работает: CSP, прямые ссылки, скрипты.`);
