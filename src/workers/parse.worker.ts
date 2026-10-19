import { expose } from 'comlink';
import { setWorkerLanguage } from '@/i18n';
addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (
    !data ||
    typeof data !== 'object' ||
    Reflect.get(data, 'type') !== 'weiguang:language'
  )
    return;
  const language: unknown = Reflect.get(data, 'language');
  if (language === 'en' || language === 'zh-Hans') setWorkerLanguage(language);
});
import { archiveList, archiveRead } from '@/parsers/bookArchive';
import { parseDraft } from '@/parsers/paste';
import { parseText, parseFile } from '@/parsers/file';
import {
  buildSnapshotArchive,
  readBackup,
  createArchiveRestoreApi,
} from '@/backup/archive';
export { parseText, parseFile };
export { parseDraft };
expose({
  archiveList,
  archiveRead,
  parseText,
  parseFile,
  parseDraft,
  buildSnapshotArchive,
  readBackup,
  ...createArchiveRestoreApi(),
});
