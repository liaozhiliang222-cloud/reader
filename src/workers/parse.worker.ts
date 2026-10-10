import { expose } from 'comlink';
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
  parseText,
  parseFile,
  parseDraft,
  buildSnapshotArchive,
  readBackup,
  ...createArchiveRestoreApi(),
});
