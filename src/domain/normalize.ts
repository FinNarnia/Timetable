/**
 * Нормализация строк для сравнения и поиска (п. 6.4, 7.4, 13.4).
 * Порядок важен: NFC → trim → нижний регистр ru-RU → «ё» в «е».
 */
export function normalize(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}
