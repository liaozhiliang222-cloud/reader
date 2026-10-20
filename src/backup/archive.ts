import { t } from '@/i18n';
import { streamArchive, type ArchiveEntry } from './streamArchive';
import { BoundedZip } from '@/parsers/zip';
import { parseFile } from '@/parsers/file';
import { parseDraft } from '@/parsers/paste';
import { bookIdForHash, sourceHash } from '@/parsers/identity';
import { parseBackupJson, validateBackup } from './validate';
import type {
  BackupPayload,
  OnBackupProgress,
  PreparedBook,
  BackupBook,
  SourceFile,
  BackupFile,
  BackupPreview,
} from './types';
import {
  BACKUP_BOOK_LIMIT,
  BACKUP_ENTRY_LIMIT,
  BACKUP_METADATA_LIMIT,
} from './limits';

export async function buildArchive(
  payload: BackupPayload,
  onProgress: OnBackupProgress = () => {},
) {
  // Fixture helper; the production Worker receives metadata and a lazy provider.
  const originals = new Map(
    payload.originals.map((source) => [source.bookId, source.data]),
  );
  return buildSnapshotArchive(
    payload.backup,
    async (bookId) => {
      const source = originals.get(bookId);
      if (!source) throw new Error(t('原文件不可用，备份未生成。'));
      return source;
    },
    onProgress,
  );
}
export async function buildSnapshotArchive(
  backup: BackupFile,
  readOriginal: (bookId: string) => Promise<Blob>,
  onProgress: OnBackupProgress = () => {},
) {
  let lastReport = 0;
  const json = new TextEncoder().encode(JSON.stringify(backup, null, 2));
  if (json.byteLength > BACKUP_METADATA_LIMIT)
    throw new Error(t('备份元数据超过 32 MiB，请减少单次备份的笔记数量。'));
  const entries: ArchiveEntry[] = [
    { path: 'backup.json', data: new Blob([json]) },
  ];
  validateBackup(backup);
  const books = new Map(backup.books.map((book) => [book.id, book]));
  for (const file of backup.files) {
    const book = books.get(file.bookId)!;
    entries.push({
      path: file.path,
      size: book.size,
      read: async () => {
        const source = await readOriginal(file.bookId);
        if (source.size !== book.size)
          throw new Error(t('备份原文大小与快照不一致。'));
        const bytes = await source.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        if (bookIdForHash(book, hash) !== book.id)
          throw new Error(t('备份生成期间原文指纹发生变化，请重新生成备份。'));
        return bytes;
      },
    });
  }
  return streamArchive(entries, (percent) => {
    const now = Date.now();
    if (percent !== 100 && now - lastReport < 100) return;
    lastReport = now;
    onProgress({
      percent,
      message: t('正在生成完整备份 {0}%', Math.floor(percent)),
    });
  });
}
export class BackupArchive {
  private books: Map<string, BackupBook>;
  private paths: Map<string, string>;
  private prepared = new Set<string>();
  private constructor(
    readonly backup: BackupFile,
    private zip: BoundedZip,
  ) {
    this.books = new Map(backup.books.map((book) => [book.id, book]));
    this.paths = new Map(backup.files.map((file) => [file.bookId, file.path]));
    for (const file of backup.files) {
      const book = this.books.get(file.bookId)!;
      if (!zip.has(file.path))
        throw new Error(t('原文件缺失或路径错误：{0}。', book.title));
      if (zip.size(file.path) !== book.size)
        throw new Error(t('原文件大小与备份信息不符，内容不完整。'));
    }
  }
  static async open(file: File) {
    const zip = await BoundedZip.load(file, {
      input: Number.MAX_SAFE_INTEGER,
      entries: BACKUP_ENTRY_LIMIT,
      entry: BACKUP_BOOK_LIMIT,
      total: Number.MAX_SAFE_INTEGER,
    });
    if (!zip.has('backup.json')) throw new Error(t('ZIP 中缺少 backup.json。'));
    const json = await zip.read('backup.json', BACKUP_METADATA_LIMIT);
    const backup = parseBackupJson(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await json.arrayBuffer(),
      ),
    );
    const books = new Map(backup.books.map((book) => [book.id, book]));
    zip.restrictTotal(
      BACKUP_METADATA_LIMIT +
        backup.files.reduce(
          (sum, source) => sum + books.get(source.bookId)!.size,
          0,
        ),
    );
    return new BackupArchive(backup, zip);
  }
  /** Verify in discard mode: no expanded book Blob is retained in the preview. */
  async verify(onProgress: OnBackupProgress = () => {}) {
    for (const [index, source] of this.backup.files.entries()) {
      await this.zip.read(
        source.path,
        this.books.get(source.bookId)!.size,
        true,
      );
      onProgress({
        percent: ((index + 1) / this.backup.files.length) * 100,
        message: t(
          '正在校验原文件 {0}/{1}',
          index + 1,
          this.backup.files.length,
        ),
      });
    }
    await this.verifyRemaining();
  }
  async prepare(bookId: string): Promise<PreparedBook> {
    const meta = this.books.get(bookId),
      path = this.paths.get(bookId);
    if (!meta || !path) throw new Error(t('恢复内容与备份书架不一致。'));
    if (this.prepared.has(bookId))
      throw new Error(t('不能重复读取同一份原文件。'));
    this.prepared.add(bookId);
    const data = await this.zip.read(path, meta.size);
    return prepareBook(meta, { bookId, data });
  }
  async verifyRemaining() {
    await this.zip.verifyRemaining();
  }
}
export async function readBackup(
  file: File,
  onProgress: OnBackupProgress = () => {},
): Promise<BackupFile> {
  if (/\.json$/i.test(file.name)) {
    if (file.size > BACKUP_METADATA_LIMIT)
      throw new Error(t('备份元数据超过 32 MiB，无法读取。'));
    const backup = parseBackupJson(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await file.arrayBuffer(),
      ),
    );
    if (backup.files.length)
      throw new Error(t('完整备份请导入 ZIP，JSON 中不包含原文件。'));
    return backup;
  }
  if (!/\.zip$/i.test(file.name))
    throw new Error(t('请选择微光阅读 JSON 或 ZIP 备份。'));
  const archive = await BackupArchive.open(file);
  await archive.verify(onProgress);
  return archive.backup;
}
/** One instance per Worker; the archive stays there for the sequential RPCs. */
export function createArchiveRestoreApi() {
  let archive: BackupArchive | undefined;
  return {
    async openRestore(preview: BackupPreview) {
      archive = undefined;
      const backup = validateBackup(preview.backup);
      if (!preview.archive) {
        if (backup.files.length)
          throw new Error(t('备份原文件不可用，请重新选择。'));
        return;
      }
      const opened = await BackupArchive.open(preview.archive);
      if (JSON.stringify(opened.backup) !== JSON.stringify(backup))
        throw new Error(t('备份内容与预览不一致，请重新选择备份。'));
      archive = opened;
    },
    async prepareRestoreBook(bookId: string) {
      if (!archive) throw new Error(t('备份原文件不可用，请重新选择。'));
      return archive.prepare(bookId);
    },
    async finishRestore() {
      await archive?.verifyRemaining();
      archive = undefined;
    },
  };
}
export async function prepareBook(
  meta: BackupBook,
  source: SourceFile,
): Promise<PreparedBook> {
  if (source.bookId !== meta.id || source.data.size !== meta.size)
    throw new Error(t('原文件大小与备份信息不一致。'));
  if (meta.type === 'pdf') return preparePdf(meta, source);
  const result =
    meta.type === 'paste'
      ? {
          ...(await parseDraft(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await source.data.arrayBuffer(),
            ),
            meta.draftFormat ?? 'plain',
            meta.markdownVersion ?? 1,
          )),
          coverBlobId: undefined,
          assets: [],
          encoding: undefined,
          parserVersion: undefined,
        }
      : await parseFile(
          await source.data.arrayBuffer(),
          meta.type,
          meta.encoding,
          meta.parserVersion ?? 1,
          meta.markdownVersion ?? 1,
        );
  if (result.id !== meta.id)
    throw new Error(t('原文件指纹不匹配：{0}。', meta.title));
  const book = {
    ...meta,
    missingFile: false,
    fileBlobId: meta.type === 'paste' ? undefined : meta.id,
    draftBlobId: meta.type === 'paste' ? meta.id + ':draft' : undefined,
    coverBlobId: result.coverBlobId,
    encoding: result.encoding,
    parserVersion: result.parserVersion,
    markdownVersion: result.markdownVersion,
    toc: result.toc,
    chapterCount: result.chapters.length,
    charCount: result.charCount,
    chapterSummaries: result.chapters.map(
      ({ index, title, charStart, charCount }) => ({
        index,
        title,
        charStart,
        charCount,
      }),
    ),
  };
  return {
    book,
    chapters: result.chapters.map((chapter) => ({
      ...chapter,
      bookId: book.id,
    })),
    blobs: [
      ...result.assets,
      { id: book.fileBlobId ?? book.draftBlobId!, data: source.data },
    ],
  };
}
async function preparePdf(
  meta: BackupBook,
  source: SourceFile,
): Promise<PreparedBook> {
  const id = bookIdForHash(
    { type: 'pdf' },
    await sourceHash(await source.data.arrayBuffer()),
  );
  if (id !== meta.id) throw new Error(t('原文件指纹不匹配：{0}。', meta.title));
  const chapters = Array.from({ length: meta.chapterCount }, (_, index) => ({
    bookId: meta.id,
    index,
    title: t('第 {0} 页', index + 1),
    paragraphs: [''],
    charStart: 0,
    charCount: 0,
  }));
  return {
    book: {
      ...meta,
      missingFile: false,
      fileBlobId: meta.id,
      chapterSummaries: chapters.map(
        ({ index, title, charStart, charCount }) => ({
          index,
          title,
          charStart,
          charCount,
        }),
      ),
    },
    chapters,
    blobs: [{ id: meta.id, data: source.data }],
  };
}
// Test/fixture helper; the production Worker exposes only the single-book operation.
export async function prepareBooks(
  payload: BackupPayload,
  onProgress: OnBackupProgress = () => {},
): Promise<PreparedBook[]> {
  const prepared: PreparedBook[] = [];
  for (const [index, source] of payload.originals.entries()) {
    const meta = payload.backup.books.find((book) => book.id === source.bookId);
    if (!meta) throw new Error(t('原文件大小与备份信息不一致。'));
    prepared.push(await prepareBook(meta, source));
    onProgress({
      percent: ((index + 1) / payload.originals.length) * 100,
      message: t('正在验证并解析 ') + meta.title,
    });
  }
  return prepared;
}
