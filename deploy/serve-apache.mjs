#!/usr/bin/env node
// Локальный Apache с .htaccess, как на хостинге spaceweb.ru: проверка сборки pnpm build:deploy (deploy/smoke.spec.ts).
// Нужен установленный apache2 (Ubuntu: apt-get install apache2). Порт 8080, корень сайта — во временной папке.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.env.BASE_PATH ?? '/timetable/';
const port = process.env.DEPLOY_PORT ?? '8080';
const root = join(tmpdir(), 'moy-ritm-apache');
const www = join(root, 'www');
rmSync(root, { recursive: true, force: true });
mkdirSync(join(www, base), { recursive: true });
cpSync(resolve('dist'), join(www, base), { recursive: true });
// Посторонняя страница в корне сайта — приложение живёт только в своей папке.
writeFileSync(join(www, 'index.html'), '<!doctype html><title>fin-narnia</title><p>Главная сайта</p>');

const modules = '/usr/lib/apache2/modules';
const conf = `
ServerRoot "${root}"
ServerName localhost
Listen ${port}
PidFile "${root}/httpd.pid"
ErrorLog "${root}/error.log"
LoadModule mpm_event_module ${modules}/mod_mpm_event.so
LoadModule authz_core_module ${modules}/mod_authz_core.so
LoadModule dir_module ${modules}/mod_dir.so
LoadModule mime_module ${modules}/mod_mime.so
LoadModule rewrite_module ${modules}/mod_rewrite.so
LoadModule headers_module ${modules}/mod_headers.so
TypesConfig /etc/mime.types
DocumentRoot "${www}"
<Directory "${www}">
  AllowOverride All
  Require all granted
</Directory>
`;
writeFileSync(join(root, 'httpd.conf'), conf);
const apache = spawn('apache2', ['-f', join(root, 'httpd.conf'), '-DFOREGROUND'], { stdio: 'inherit' });
const stop = () => apache.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
apache.on('exit', (code) => process.exit(code ?? 0));
