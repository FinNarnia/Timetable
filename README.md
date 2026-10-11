# Мой ритм

Планировщик задач и трекер привычек. MVP работает в браузере без сервера: все данные хранятся локально в IndexedDB. Требования — в ТЗ (tz.md), ход разработки — в [plan.md](plan.md).

## Установка

Нужны Node.js 22 (см. `.nvmrc`) и pnpm.

```bash
corepack enable        # однократно, если pnpm ещё не установлен
pnpm install
pnpm exec playwright install chromium   # браузер для сквозных тестов
```

## Команды

| Команда | Что делает |
| --- | --- |
| `pnpm dev` | Режим разработки, http://localhost:5173 |
| `pnpm build` | Проверка типов и сборка в `dist/` |
| `pnpm preview` | Запуск собранной версии с заголовками безопасности, http://localhost:4173 |
| `pnpm test` | Модульные и интеграционные тесты (Vitest, fake-indexeddb) |
| `pnpm test:coverage` | То же с покрытием; Domain должен быть покрыт не менее чем на 90% |
| `pnpm test:e2e` | Сквозные тесты Playwright против production-сборки (Chromium) |
| `E2E_ALL_BROWSERS=1 pnpm test:e2e` | Сквозные тесты в Chromium, Firefox и WebKit |
| `pnpm lint` | ESLint, включая проверку границ слоёв |
| `pnpm typecheck` | Проверка типов TypeScript |
| `pnpm seed -- --tasks 10000 --checks 20000 --out файл.json` | Генерация резервной копии с тестовыми данными |
| `pnpm build:deploy` | Сборка для fin-narnia.online/timetable/ с `.htaccess` |
| `pnpm test:deploy` | Проверка этой сборки на локальном Apache |
| `pnpm check:bundle` | Бюджет начального JS (≤ 250 КБ gzip) |
| `pnpm lighthouse` | Lighthouse CI: LCP и доступность, мобильный и настольный профили |
| `PERF_STRICT=1 pnpm test:e2e --grep @perf` | Бенчмарки п. 15.2 со строгими порогами |
| `node scripts/screenshots.mjs step-N` | Скриншоты ключевых экранов (нужен запущенный `pnpm preview`) |

## Архитектура

Слои — п. 14.2 ТЗ. Нарушение границ ловит линтер (`eslint-plugin-boundaries`).

```
src/
  domain/          сущности и чистые правила; зависит только от date-fns; время передаётся аргументом
  repositories/    интерфейсы доступа к данным и сервисов окружения (Clock, IdentityProvider, UnitOfWork…)
  application/     пользовательские операции (задачи, серии, привычки, отчёты, уведомление, резервная копия)
  infrastructure/  IndexedDB (Dexie), локальная идентификация, BroadcastChannel, Web Locks, Notification API, системные часы
  ui/              React-страницы и компоненты; получает сервисы через контекст
  composition-root.ts  подключает реализации к интерфейсам — облачная версия заменит только этот файл
```

- Текущее время — только через `Clock` (`Date.now()` и `new Date()` без аргументов запрещены линтером вне `SystemClock`).
- UI не обращается к IndexedDB и Dexie напрямую.
- Каждая сущность содержит `userId`, `rev`, `createdAt`, `updatedAt`, `deletedAt`; репозиторий заполняет их сам.

## Как добавить миграцию схемы

1. Сохраните снимок текущей версии: добавьте `fixtures/migrations/vN.json` (схема хранилищ и пример данных) по образцу `v1.json`.
2. В `src/infrastructure/db.ts` добавьте элемент в `SCHEMA_MIGRATIONS` с новой версией, полным описанием хранилищ и при необходимости `upgrade`.
3. Если меняется формат записей, добавьте такую же функцию в `BACKUP_MIGRATIONS` (`src/application/backup/parseBackup.ts`), чтобы старые резервные копии тоже импортировались.
4. Тест `tests/integration/backup.test.ts` проверит открытие базы на каждом снимке.

## Сквозные тесты и время

Тесты идут против `pnpm build && pnpm preview`, то есть с настоящим CSP. Любая ошибка в консоли браузера (включая нарушения CSP) валит тест. Для сценариев со временем используется `page.clock` (шаги 4 и далее).

## Публикация на fin-narnia.online/timetable/

Приложение статическое: сервер не нужен, данные остаются в браузере. Хостинг — spaceweb.ru (Apache).

- `pnpm build:deploy` собирает приложение для адреса `/timetable/` и кладёт в `dist/` файл `.htaccess`: заголовки безопасности (CSP без `unsafe-inline`, п. 15.1), перенаправление всех адресов приложения на `index.html`, кэширование файлов с хешем.
- `pnpm test:deploy` проверяет эту сборку на локальном Apache с тем же `.htaccess` (нужен `apache2`).
- Публикует GitHub Actions (`.github/workflows/ci.yml`, задание `deploy`): после зелёных проверок в ветке `main` — сборка, проверка на Apache, загрузка по SFTP (или FTPS) и проверка живого сайта (`deploy/check-live.mjs`).

### Первая настройка (один раз)

1. Создайте на GitHub пустой приватный репозиторий и загрузите в него эту папку (ветка `main`). Папку `Claude outputs` загружать не нужно — она в `.gitignore`.
2. В панели spaceweb.ru:
   - включите SSH-доступ (раздел «SSH»), если он выключен, — тогда загрузка пойдёт по SFTP; иначе используйте FTP с шифрованием (FTPS);
   - включите SSL-сертификат для fin-narnia.online и перенаправление на HTTPS;
   - узнайте путь к папке сайта (обычно `fin-narnia.online/public_html`).
3. В репозитории на GitHub: **Settings → Secrets and variables → Actions → New repository secret**, добавьте:

| Секрет | Пример | Что это |
| --- | --- | --- |
| `DEPLOY_HOST` | адрес SSH/FTP-сервера из панели spaceweb | сервер для загрузки |
| `DEPLOY_USER` | логин из панели | пользователь |
| `DEPLOY_PASSWORD` | пароль | пароль SSH/FTP |
| `DEPLOY_PATH` | `fin-narnia.online/public_html/timetable` | папка приложения; должна оканчиваться на `/timetable` — иначе загрузка остановится (защита от удаления чужих файлов) |
| `DEPLOY_PROTOCOL` | `sftp` или `ftp` | необязательно; по умолчанию `sftp`, `ftp` — FTP с обязательным шифрованием |

4. Сделайте любой коммит в `main` (или запустите workflow вручную: **Actions → CI → Run workflow**). После зелёных проверок приложение появится по адресу https://fin-narnia.online/timetable/.

Если проверка живого сайта сообщает, что нет заголовка Content-Security-Policy, значит хостинг отдаёт файлы в обход `.htaccess`: в панели spaceweb отключите отдачу статических файлов через nginx для этого сайта (или напишите в поддержку, что нужен `mod_headers` для `/timetable/`).

### Производительность (п. 15.2)

Эталонное окружение — задание `perf` в GitHub Actions: Lighthouse CI (`pnpm lighthouse`, LCP мобильный ≤ 2,5 с, настольный ≤ 1,5 с) и бенчмарки `pnpm test:e2e --grep @perf` с `PERF_STRICT=1` (пороги ТЗ). В обычных прогонах те же бенчмарки работают как защита от грубой регрессии. Начальный JS проверяет `pnpm check:bundle` (≤ 250 КБ gzip).
