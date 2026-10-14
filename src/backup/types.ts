import type {
  AppSettings,
  Book,
  Bookmark,
  Highlight,
  Progress,
  StoredChapter,
} from '@/types';
export const BACKUP_VERSION = 5;
export type BackupBook = Omit<
  Book,
  'fileBlobId' | 'coverBlobId' | 'draftBlobId'
>;
export interface BackupFile {
  app: 'jingye';
  schemaVersion: number;
  exportedAt: number;
  kind: 'light' | 'full';
  books: BackupBook[];
  progress: Progress[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
  settings: AppSettings;
  files: { bookId: string; path: string }[];
}
export interface SourceFile {
  bookId: string;
  data: Blob;
}
export interface BackupPayload {
  backup: BackupFile;
  originals: SourceFile[];
}
export interface SnapshotSource {
  bookId: string;
  blobId: string;
  size: number;
}
/** Export snapshots carry keys, not all original Blob handles. */
export interface BackupSnapshot {
  backup: BackupFile;
  sources: SnapshotSource[];
}
/** Preview retains the selected archive, never the expanded original books. */
export interface BackupPreview {
  backup: BackupFile;
  archive?: File;
}
export interface PreparedBook {
  book: Book;
  chapters: StoredChapter[];
  blobs: { id: string; data: Blob }[];
}
export interface BackupProgress {
  percent: number;
  message: string;
}
export type OnBackupProgress = (progress: BackupProgress) => void;
export function sourcePath(book: Pick<Book, 'id' | 'type'>) {
  return `books/${encodeURIComponent(book.id)}.${book.type === 'paste' ? 'md' : book.type}`;
}
export function backupFilename(kind: 'light' | 'full', date = new Date()) {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return `静页备份_${day}.${kind === 'full' ? 'zip' : 'json'}`;
}
