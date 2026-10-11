#!/usr/bin/env node
// Начальный JS ≤ 250 КБ gzip (п. 15.2): всё, что index.html загружает сразу (точка входа и modulepreload).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 250 * 1024;
const html = readFileSync('dist/index.html', 'utf8');
const files = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1].replace(/^.*?\/assets\//, 'assets/'));
if (files.length === 0) throw new Error('В dist/index.html не найдено скриптов — сначала pnpm build');
let total = 0;
for (const file of files) {
  const size = gzipSync(readFileSync(join('dist', file)), { level: 9 }).length;
  total += size;
  console.log(`${file}: ${(size / 1024).toFixed(1)} КБ gzip`);
}
console.log(`Начальный JS: ${(total / 1024).toFixed(1)} КБ gzip (лимит ${LIMIT / 1024} КБ)`);
if (total > LIMIT) {
  console.error('Превышен бюджет начального JS (п. 15.2)');
  process.exit(1);
}
