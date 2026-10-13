import { initialSettings } from '@/app/defaults';
import { validRate, validTimer } from '@/reader/speech/protocol';
import { comparePosition } from '@/reader/annotation';
import { bookIdForHash } from '@/parsers/identity';
import {
  BACKUP_VERSION,
  sourcePath,
  type BackupFile,
  type BackupBook,
} from './types';
import type {
  AppSettings,
  Bookmark,
  ChapterSummary,
  Highlight,
  Locator,
  Progress,
  ReadingSettings,
} from '@/types';
const error = (field: string): never => {
  throw new Error(`备份格式不正确：${field}。`);
};
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return error(field);
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()))
    return error(field);
  return value;
}
function number(
  value: unknown,
  field: string,
  max = Number.MAX_SAFE_INTEGER,
  integer = true,
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    return error(field);
  return value;
}
function boolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') return error(field);
  return value;
}
function choice<const T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    return error(field);
  return value as T;
}
function array<T>(value: unknown, field: string, read: (item: unknown) => T) {
  if (!Array.isArray(value)) return error(field);
  return value.map(read);
}
const fingerprint = (value: unknown) => {
  const id = string(value, '书籍指纹');
  return /^(?:paste:|paste-md:|md:)?[a-f\d]{64}$/.test(id)
    ? id
    : error('书籍指纹');
};
const optionalText = (value: unknown, field: string) =>
  value === undefined ? undefined : string(value, field, true);
export function validateReading(value: unknown): Partial<ReadingSettings> {
  const data = record(value, '排版设置'),
    result: Partial<ReadingSettings> = {};
  if (data.fontSize !== undefined) {
    const size = number(data.fontSize, '字号', 28);
    if (size < 14) error('字号');
    result.fontSize = size;
  }
  if (data.lineHeight !== undefined) {
    const n = number(data.lineHeight, '行距', 2.2, false);
    if (![1.4, 1.6, 1.8, 2, 2.2].includes(n)) error('行距');
    result.lineHeight = n;
  }
  if (data.paragraphSpacing !== undefined) {
    const n = number(data.paragraphSpacing, '段距', 1, false);
    if (![0, 0.5, 1].includes(n)) error('段距');
    result.paragraphSpacing = n;
  }
  if (data.margin !== undefined)
    result.margin = choice(data.margin, ['narrow', 'medium', 'wide'], '边距');
  if (data.fontFamily !== undefined)
    result.fontFamily = choice(
      data.fontFamily,
      ['serif', 'sans', 'wenkai'],
      '字体',
    );
  if (data.align !== undefined)
    result.align = choice(data.align, ['justify', 'left'], '对齐');
  if (data.theme !== undefined)
    result.theme = choice(
      data.theme,
      ['paper', 'eink', 'green', 'night'],
      '主题',
    );
  if (data.lightTheme !== undefined)
    result.lightTheme = choice(
      data.lightTheme,
      ['paper', 'eink', 'green'],
      '浅色主题',
    );
  if (data.pageAnimation !== undefined)
    result.pageAnimation = choice(
      data.pageAnimation,
      ['none', 'fade', 'slide'],
      '动效',
    );
  if (data.tapMode !== undefined)
    result.tapMode = choice(data.tapMode, ['normal', 'oneHand'], '点击区域');
  if (data.wakeLock !== undefined)
    result.wakeLock = choice(
      data.wakeLock,
      ['off', 'idle5m', 'always'],
      '常亮',
    );
  for (const key of [
    'indent',
    'texture',
    'showHeaderFooter',
    'quietHint',
    'volumeKeys',
  ] as const)
    if (data[key] !== undefined) result[key] = boolean(data[key], key);
  return result;
}
function readSettings(value: unknown): AppSettings {
  const data = record(value, '设置'),
    defaults = initialSettings();
  const result = {
    ...defaults,
    reading: { ...defaults.reading, ...validateReading(data.reading ?? {}) },
  };
  if (data.speech !== undefined) {
    const speech = record(data.speech, '听书设置');
    if (!validRate(speech.rate) || !validTimer(speech.timer))
      return error('听书设置');
    result.speech = { rate: speech.rate, timer: speech.timer };
  }
  if (data.shelfSort !== undefined)
    result.shelfSort = choice(
      data.shelfSort,
      ['recent', 'imported', 'title'],
      '书架排序',
    );
  for (const key of [
    'autoResume',
    'followSystemTheme',
    'checkUpdates',
    'onboarded',
  ] as const)
    if (data[key] !== undefined) result[key] = boolean(data[key], key);
  if (data.lastBookId !== undefined)
    result.lastBookId = fingerprint(data.lastBookId);
  if (data.lastBackupAt !== undefined)
    result.lastBackupAt = number(data.lastBackupAt, '备份时间');
  if (data.backupReminderDismissed !== undefined) {
    const dismissed = record(data.backupReminderDismissed, '提醒关闭状态');
    result.backupReminderDismissed = {
      baseline: number(dismissed.baseline, '提醒基准时间'),
      cycle: number(dismissed.cycle, '提醒周期'),
    };
  }
  return result;
}
function readBook(value: unknown): BackupBook {
  const data = record(value, '书籍');
  const book: BackupBook = {
    id: fingerprint(data.id),
    title: string(data.title, '书名'),
    type: choice(data.type, ['txt', 'epub', 'paste', 'md'], '书籍类型'),
    author: optionalText(data.author, '作者'),
    charCount: number(data.charCount, '字数'),
    chapterCount: number(data.chapterCount, '章节数'),
    size: number(data.size, '原文大小', 50 * 1024 * 1024),
    importedAt: number(data.importedAt, '导入时间'),
    lastReadAt:
      data.lastReadAt === undefined
        ? number(data.importedAt, '导入时间')
        : number(data.lastReadAt, '阅读时间'),
  };
  if (data.draftFormat !== undefined) {
    if (book.type !== 'paste') error('文稿格式');
    book.draftFormat = choice(data.draftFormat, ['markdown'], '文稿格式');
  }
  if (data.markdownVersion !== undefined) {
    if (
      (data.markdownVersion !== 1 && data.markdownVersion !== 2) ||
      !(book.type === 'md' || book.draftFormat === 'markdown')
    )
      error('Markdown解析版本');
    book.markdownVersion = data.markdownVersion === 1 ? 1 : 2;
  }
  if (
    (book.type === 'md' || book.draftFormat === 'markdown') &&
    book.markdownVersion === undefined
  )
    error('Markdown解析版本');
  if (
    bookIdForHash(book, book.id.slice(-64)) !== book.id ||
    book.chapterCount < 1
  )
    error('书籍类型或章节数');
  if (data.encoding !== undefined)
    book.encoding = choice(
      data.encoding,
      ['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'big5'],
      '编码',
    );
  if (data.contentRevision !== undefined)
    book.contentRevision = number(data.contentRevision, '内容版本');
  if (data.parserVersion !== undefined) {
    const version = data.parserVersion;
    if (version === 1 || version === 2 || version === 3)
      book.parserVersion = version;
    else error('EPUB解析版本');
  }
  if (data.settingsOverride !== undefined)
    book.settingsOverride = validateReading(data.settingsOverride);
  if (data.missingFile !== undefined)
    book.missingFile = boolean(data.missingFile, '原文状态');
  if (data.chapterSummaries !== undefined)
    book.chapterSummaries = array(
      data.chapterSummaries,
      '章节摘要',
      (v): ChapterSummary => {
        const c = record(v, '章节摘要');
        return {
          index: number(c.index, '章节索引', book.chapterCount - 1),
          title: string(c.title, '章节标题', true),
          charStart: number(c.charStart, '章节位置'),
          charCount: number(c.charCount, '章节字数'),
          level:
            c.level === undefined ? undefined : number(c.level, '层级', 64),
        };
      },
    );
  if (data.toc !== undefined)
    book.toc = array(data.toc, '目录', (v) => {
      const t = record(v, '目录项');
      return {
        title: string(t.title, '目录标题', true),
        chapterIndex: number(t.chapterIndex, '目录章节', book.chapterCount - 1),
        paragraphIndex: number(t.paragraphIndex, '目录段落'),
        level: number(t.level, '层级', 64),
        anchor: optionalText(t.anchor, '目录锚点'),
      };
    });
  return book;
}
function position(value: unknown) {
  const data = record(value, '段落位置');
  return {
    paragraphIndex: number(data.paragraphIndex, '段落索引'),
    charOffset: number(data.charOffset, '字符偏移'),
  };
}
function locator(value: unknown): Locator {
  const data = record(value, '阅读位置');
  return {
    chapterIndex: number(data.chapterIndex, '章节索引'),
    ...position(data),
  };
}
export function validateBackup(value: unknown): BackupFile {
  const data = record(value, '文件');
  if (data.app !== 'jingye') throw new Error('这不是静页备份文件。');
  if (
    data.schemaVersion !== 1 &&
    data.schemaVersion !== 2 &&
    data.schemaVersion !== 3 &&
    data.schemaVersion !== BACKUP_VERSION
  )
    throw new Error('备份版本不受支持，请使用与备份匹配的静页版本。');
  const books = array(data.books, '书架', readBook),
    ids = new Set<string>();
  for (const book of books) {
    if (ids.has(book.id)) error('重复书籍');
    ids.add(book.id);
  }
  const bookFor = (id: string) =>
    books.find((book) => book.id === id) ?? error('记录引用了不存在的书籍');
  const checkLocator = (id: string, value: Locator) => {
    if (value.chapterIndex >= bookFor(id).chapterCount) error('位置超出章节');
  };
  const unique = <T>(items: T[], key: (item: T) => string, field: string) => {
    if (new Set(items.map(key)).size !== items.length) error(`重复${field}`);
    return items;
  };
  for (const book of books) {
    if ((book.parserVersion ?? 1) > data.schemaVersion)
      error(`新EPUB解析规则需要第${book.parserVersion}版备份`);
    if (book.markdownVersion && data.schemaVersion < 4)
      error('Markdown需要第4版备份');
  }
  const progress = unique(
    array(data.progress, '进度', (v): Progress => {
      const p = record(v, '进度'),
        bookId = fingerprint(p.bookId),
        where = locator(p.locator);
      checkLocator(bookId, where);
      return {
        bookId,
        locator: where,
        percent: number(p.percent, '百分比', 100, false),
        updatedAt: number(p.updatedAt, '进度时间'),
      };
    }),
    (p) => p.bookId,
    '进度',
  );
  const bookmarks = unique(
    array(data.bookmarks, '书签', (v): Bookmark => {
      const b = record(v, '书签'),
        bookId = fingerprint(b.bookId),
        where = locator(b.locator);
      const unanchored =
        b.unanchored === undefined
          ? undefined
          : boolean(b.unanchored, '书签位置状态');
      bookFor(bookId);
      if (!unanchored) checkLocator(bookId, where);
      return {
        id: string(b.id, '书签ID'),
        bookId,
        locator: where,
        chapterTitle: string(b.chapterTitle, '章节名', true),
        excerpt: string(b.excerpt, '书签摘录', true),
        createdAt: number(b.createdAt, '书签时间'),
        ...(unanchored === undefined ? {} : { unanchored }),
      };
    }),
    (b) => b.id,
    '书签',
  );
  const highlights = unique(
    array(data.highlights, '划线', (v): Highlight => {
      const h = record(v, '划线'),
        bookId = fingerprint(h.bookId),
        chapterIndex = number(h.chapterIndex, '划线章节');
      const start = position(h.start),
        end = position(h.end);
      const unanchored =
        h.unanchored === undefined
          ? undefined
          : boolean(h.unanchored, '划线位置状态');
      bookFor(bookId);
      if (!unanchored) checkLocator(bookId, { chapterIndex, ...start });
      if (comparePosition(start, end) >= 0) error('划线范围');
      return {
        id: string(h.id, '划线ID'),
        bookId,
        chapterIndex,
        start,
        end,
        text: string(h.text, '原文引用'),
        color: choice(h.color, ['red', 'blue', 'yellow'], '划线颜色'),
        note: optionalText(h.note, '笔记'),
        createdAt: number(h.createdAt, '划线时间'),
        updatedAt: number(h.updatedAt, '笔记时间'),
        ...(unanchored === undefined ? {} : { unanchored }),
      };
    }),
    (h) => h.id,
    '划线',
  );
  const settings = readSettings(data.settings);
  if (settings.lastBookId && !ids.has(settings.lastBookId))
    error('续读书籍不存在');
  const files = unique(
    array(data.files ?? [], '原文件列表', (v) => {
      const f = record(v, '原文件'),
        bookId = fingerprint(f.bookId),
        book = bookFor(bookId);
      const path = string(f.path, '原文件路径');
      if (path !== sourcePath(book)) error('原文件路径');
      return { bookId, path };
    }),
    (f) => f.bookId,
    '原文件',
  );
  const kind = choice(
    data.kind ?? (files.length ? 'full' : 'light'),
    ['light', 'full'],
    '备份类型',
  );
  if (kind === 'light' && files.length) error('轻量备份不应包含原文件');
  return {
    app: 'jingye',
    schemaVersion: BACKUP_VERSION,
    exportedAt: number(data.exportedAt, '导出时间'),
    kind,
    books,
    progress,
    bookmarks,
    highlights,
    settings,
    files,
  };
}
export function parseBackupJson(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('备份 JSON 无法读取，请检查文件是否完整。');
  }
  return validateBackup(value);
}
