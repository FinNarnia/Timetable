/// <reference lib="webworker" />
import { parseBackupText } from './parseBackup';

// Разбор и проверка файла копии в отдельном потоке, чтобы не замораживать интерфейс (п. 4.4).
self.onmessage = (event: MessageEvent<{ text: string; schemaVersion: number }>) => {
  const { text, schemaVersion } = event.data;
  self.postMessage(parseBackupText(text, schemaVersion));
};
