import type { TextChapter } from '@/parsers/txt/chapters';
import type { TocEntry } from '@/parsers/epub/parse';
import type { SafeNode } from '@/parsers/epub/sanitize';
import type { EpubParserVersion } from '@/parsers/epub/version';

export interface Locator {
  chapterIndex: number;
  paragraphIndex: number;
  charOffset: number;
}
export type ReadingLocation =
  | { kind: 'text'; locator: Locator }
  | { kind: 'pdf'; pageIndex: number; x: number; y: number; scale: number };
export interface Book {
  id: string;
  sourceFingerprint?: string;
  identityVersion?: 1;
  title: string;
  type: 'txt' | 'epub' | 'paste' | 'md' | 'pdf';
  documentVersion?: 1;
  pageCount?: number;
  draftFormat?: 'markdown';
  markdownVersion?: 1 | 2;
  encoding?: string;
  contentRevision?: number;
  parserVersion?: EpubParserVersion;
  author?: string;
  coverBlobId?: string;
  fileBlobId?: string;
  draftBlobId?: string;
  settingsOverride?: Partial<ReadingSettings>;
  missingFile?: boolean;
  toc?: TocEntry[];
  chapterSummaries?: ChapterSummary[];
  charCount: number;
  chapterCount: number;
  importedAt: number;
  lastReadAt: number;
  size: number;
}
export type ChapterSummary = Pick<
  TextChapter,
  'index' | 'title' | 'charStart' | 'charCount'
> & { level?: number };
export interface StoredChapter extends TextChapter {
  bookId: string;
  html?: string;
  level?: number;
  nodes?: SafeNode[];
}

export interface Bookmark {
  id: string;
  bookId: string;
  locator: Locator;
  chapterTitle: string;
  excerpt: string;
  createdAt: number;
  unanchored?: boolean;
}
export interface Highlight {
  id: string;
  bookId: string;
  chapterIndex: number;
  start: { paragraphIndex: number; charOffset: number };
  end: { paragraphIndex: number; charOffset: number };
  text: string;
  color: 'red' | 'blue' | 'yellow';
  note?: string;
  createdAt: number;
  updatedAt: number;
  unanchored?: boolean;
  tags?: string[];
  reviewPending?: boolean;
  archivedSource?: { title: string; chapterTitle: string };
}
export interface ReadingSettings {
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  margin: 'narrow' | 'medium' | 'wide';
  indent: boolean;
  fontFamily: 'serif' | 'sans' | 'wenkai';
  align: 'justify' | 'left';
  theme: 'paper' | 'eink' | 'green' | 'night';
  lightTheme?: 'paper' | 'eink' | 'green';
  texture: boolean;
  pageAnimation: 'none' | 'fade' | 'slide';
  tapMode: 'normal' | 'oneHand';
  showHeaderFooter: boolean;
  wakeLock: 'off' | 'idle5m' | 'always';
  quietHint: boolean;
  /** 音量键翻页；仅安卓 App 生效，默认关闭 */
  volumeKeys?: boolean;
}
export interface AppSettings {
  speech?: { rate: number; timer: 'off' | '15m' | '30m' | '60m' | 'chapter' };
  shelfSort: 'recent' | 'imported' | 'title';
  reading: ReadingSettings;
  autoResume: boolean;
  lastBookId?: string;
  followSystemTheme: boolean;
  checkUpdates: boolean;
  onboarded: boolean;
  lastBackupAt?: number;
  backupReminderDismissed?: { baseline: number; cycle: number };
  environmentNoticeDismissed?: string;
  tapHintSeen?: boolean;
}
export interface Progress {
  bookId: string;
  locator: Locator;
  location?: ReadingLocation;
  percent: number;
  updatedAt: number;
}
