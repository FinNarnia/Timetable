#!/usr/bin/env node
// Сборка для хостинга: путь публикации (по умолчанию /timetable/) и .htaccess для Apache (spaceweb.ru).
// Использование: pnpm build:deploy  или  BASE_PATH=/other/ pnpm build:deploy
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { SECURITY_HEADERS } from './security-headers.mjs';

const base = process.env.BASE_PATH ?? '/timetable/';
if (!/^\/([\w-]+\/)*$/.test(base)) throw new Error(`BASE_PATH должен начинаться и заканчиваться на «/»: ${base}`);

execSync('pnpm build', { stdio: 'inherit', env: { ...process.env, BASE_PATH: base } });

const headers = Object.entries(SECURITY_HEADERS)
  .map(([name, value]) => `  Header always set ${name} "${value}"`)
  .join('\n');

// Apache: заголовки безопасности (п. 15.1), все адреса приложения → index.html (п. 17), кэш для файлов с хешем.
const htaccess = `# «Мой ритм» — настройки Apache для ${base}. Файл создаётся командой pnpm build:deploy.
DirectoryIndex index.html
AddType application/javascript .js .mjs
AddType image/svg+xml .svg
AddType font/woff2 .woff2

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase ${base}
  RewriteRule ^index\\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . ${base}index.html [L]
</IfModule>

<IfModule mod_headers.c>
${headers}
  # index.html всегда проверяется заново — после обновления браузер сразу получает новую версию.
  <FilesMatch "\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  # Файлы сборки с хешем в имени не меняются — кэшируем надолго.
  <FilesMatch "-[A-Za-z0-9_-]{8,}\\.(js|css|woff2?|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
`;
writeFileSync('dist/.htaccess', htaccess);
console.log(`Сборка для ${base} готова: dist/ (с .htaccess)`);
