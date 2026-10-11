import { describe, expect, it } from 'vitest';
import { normalize } from '../../src/domain/normalize';
import { validateProfileName, defaultSettings, makeProfile } from '../../src/domain/profile';
import { formatLongDate, formatDateTime, greetingFor, toIsoDate } from '../../src/domain/dates';

describe('normalize (п. 6.4, 13.4)', () => {
  it('приводит к нижнему регистру ru-RU и убирает пробелы по краям', () => {
    expect(normalize('  РаБоТа  ')).toBe('работа');
  });
  it('заменяет «ё» на «е» в любом регистре', () => {
    expect(normalize('Ёлка ЁЖ')).toBe('елка еж');
    expect(normalize('ёлка')).toBe(normalize('ЕЛКА'));
  });
  it('выполняет Unicode NFC до сравнения', () => {
    const decomposed = 'ёлка'; // «е» + комбинируемая диакритика
    const composed = 'ёлка';
    expect(decomposed).not.toBe(composed);
    expect(normalize(decomposed)).toBe(normalize(composed));
    expect(normalize(decomposed)).toBe('елка');
  });
  it('не трогает латиницу и цифры, кроме регистра', () => {
    expect(normalize('Work 2026')).toBe('work 2026');
  });
});

describe('validateProfileName (п. 4.1)', () => {
  it.each([
    ['', 'Введите имя'],
    ['   ', 'Введите имя'],
    ['А', 'Имя должно быть не короче 2 символов'],
    [' А ', 'Имя должно быть не короче 2 символов'],
    ['а'.repeat(51), 'Имя должно быть не длиннее 50 символов'],
  ])('отклоняет %j', (raw, error) => {
    expect(validateProfileName(raw)).toEqual({ ok: false, error });
  });
  it.each([['Ан'], ['Анна'], ['а'.repeat(50)], ['  Анна Петровна  ']])('принимает %j и обрезает пробелы', (raw) => {
    const result = validateProfileName(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(raw.trim());
  });
  it('считает символы, а не UTF-16 единицы', () => {
    expect(validateProfileName('😀😀').ok).toBe(true);
  });
});

describe('настройки по умолчанию (п. 10.1, 13.2)', () => {
  it('уведомление включено на 20:00, неделя с понедельника', () => {
    const s = defaultSettings('u1', '2026-10-09T10:00:00.000Z');
    expect(s).toMatchObject({
      userId: 'u1',
      locale: 'ru-RU',
      weekStartsOn: 1,
      eveningReminderEnabled: true,
      eveningReminderTime: '20:00',
      lastExportAt: null,
      lastMaintenanceDate: null,
    });
  });
  it('makeProfile', () => {
    expect(makeProfile('id', 'Анна', 'T')).toEqual({ id: 'id', name: 'Анна', createdAt: 'T', updatedAt: 'T' });
  });
});

describe('даты (п. 1.4)', () => {
  const d = new Date(2026, 9, 9, 15, 5);
  it('toIsoDate — локальная дата', () => expect(toIsoDate(d)).toBe('2026-10-09'));
  it('длинная дата с днём недели', () => expect(formatLongDate(d)).toBe('Пятница, 09.10.2026'));
  it('дата и время ДД.ММ.ГГГГ ЧЧ:ММ', () => expect(formatDateTime(d)).toBe('09.10.2026 15:05'));
  it.each([
    [3, 'Доброй ночи'],
    [9, 'Доброе утро'],
    [15, 'Добрый день'],
    [21, 'Добрый вечер'],
  ])('приветствие в %i ч', (h, text) => expect(greetingFor(new Date(2026, 9, 9, h))).toBe(text));
});
