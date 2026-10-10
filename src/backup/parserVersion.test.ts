import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { parseFile } from '@/parsers/file';
import { compatibilityEpub } from '@/parsers/epub/compatFixtures';
import { initialSettings } from '@/app/defaults';
import {
  BackupArchive,
  buildArchive,
  readBackup,
  prepareBooks,
} from './archive';
import { restoreBackup } from './restore';
import { validateBackup } from './validate';
import { BACKUP_VERSION, sourcePath, type BackupPayload } from './types';
import type { EpubParserVersion } from '@/parsers/epub/version';
import { svgEpub } from '@/parsers/epub/svgFixture';
beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
async function payload(version: EpubParserVersion, original?: Blob) {
  const data =
    original ??
    new Blob([
      await compatibilityEpub(
        '<ul><li>段前<p id="target">正文</p>段后</li></ul><table><tr><td>甲</td><td>乙</td></tr></table>',
      ),
    ]);
  const parsed = await parseFile(
    await data.arrayBuffer(),
    'epub',
    undefined,
    version,
  );
  const book = {
    id: parsed.id,
    title: '兼容备份',
    type: 'epub' as const,
    parserVersion: version === 1 ? undefined : version,
    size: data.size,
    charCount: parsed.charCount,
    chapterCount: 1,
    importedAt: 1,
    lastReadAt: 1,
  };
  const backup: BackupPayload = {
    originals: [{ bookId: book.id, data }],
    backup: {
      app: 'jingye',
      schemaVersion: version,
      kind: 'full',
      exportedAt: 1,
      books: [book],
      files: [{ bookId: book.id, path: sourcePath(book) }],
      settings: initialSettings(),
      progress: [
        {
          bookId: book.id,
          locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 1 },
          percent: 5,
          updatedAt: 1,
        },
      ],
      bookmarks: [],
      highlights: [],
    },
  };
  return { backup, parsed };
}
it.each([1, 2, 3] as const)(
  '完整备份v%s往返恢复原段落与进度，旧数据无解析版本时仍沿用v1',
  async (version) => {
    const { backup, parsed } = await payload(version);
    const file = new File([await buildArchive(backup)], 'backup.zip');
    const read = await readBackup(file);
    const archive = await BackupArchive.open(file);
    const prepared = [await archive.prepare(read.books[0]!.id)];
    await archive.verifyRemaining();
    expect(prepared[0]?.chapters[0]?.paragraphs).toEqual(
      parsed.chapters[0]?.paragraphs,
    );
    expect(prepared[0]?.book.parserVersion).toBe(version);
    await restoreBackup({ backup: read }, prepared, 'overwrite');
    expect((await db.books.get(parsed.id))?.parserVersion).toBe(version);
    expect((await db.progress.get(parsed.id))?.locator.charOffset).toBe(1);
  },
);
it('同指纹不同段落规则不能静默合并；完整覆盖按备份规则恢复', async () => {
  const old = await payload(1),
    current = await payload(2, old.backup.originals[0]!.data);
  await restoreBackup(
    current.backup,
    await prepareBooks(current.backup),
    'overwrite',
  );
  await expect(
    restoreBackup(old.backup, await prepareBooks(old.backup), 'merge'),
  ).rejects.toThrow('段落结构版本不同');
  expect((await db.books.get(old.parsed.id))?.parserVersion).toBe(2);
  await restoreBackup(old.backup, await prepareBooks(old.backup), 'overwrite');
  expect((await db.books.get(old.parsed.id))?.parserVersion).toBe(1);
});
it('新备份版本阻止旧应用误读，当前应用接受v1，拒绝未知解析版本和错误版本组合', async () => {
  const { backup } = await payload(2);
  expect(BACKUP_VERSION).toBe(4);
  expect(() => validateBackup({ ...backup.backup, schemaVersion: 1 })).toThrow(
    '第2版',
  );
  expect(() =>
    validateBackup({
      ...backup.backup,
      books: [{ ...backup.backup.books[0], parserVersion: 4 }],
    }),
  ).toThrow('解析版本');
  expect(validateBackup((await payload(1)).backup.backup).schemaVersion).toBe(
    4,
  );
  expect(validateBackup(backup.backup).books[0]?.parserVersion).toBe(2);
  const v3 = (await payload(3)).backup.backup;
  expect(() => validateBackup({ ...v3, schemaVersion: 2 })).toThrow('第3版');
});
it('含 SVG 的同一原文件按各备份版本恢复；拒绝跨版本合并并保留笔记位置', async () => {
  const original = new Blob([await svgEpub()]);
  const legacy = await payload(2, original),
    modern = await payload(3, original);
  modern.backup.backup.progress[0]!.locator.paragraphIndex = 1;
  for (const [item, paragraphIndex] of [
    [legacy, 0],
    [modern, 1],
  ] as const) {
    const bookId = item.parsed.id;
    item.backup.backup.bookmarks = [
      {
        id: 'svg-bookmark',
        bookId,
        locator: { chapterIndex: 0, paragraphIndex, charOffset: 0 },
        chapterTitle: '正文',
        excerpt: '正文位置',
        createdAt: 1,
      },
    ];
    item.backup.backup.highlights = [
      {
        id: 'svg-note',
        bookId,
        chapterIndex: 0,
        start: { paragraphIndex, charOffset: 0 },
        end: { paragraphIndex, charOffset: 2 },
        text: '正文',
        note: '保存原位置',
        color: 'red',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
  }
  const preparedLegacy = await prepareBooks(legacy.backup);
  const preparedModern = await prepareBooks(modern.backup);
  expect(preparedLegacy[0]?.chapters[0]?.paragraphs).toEqual(['正文位置', '']);
  expect(preparedModern[0]?.chapters[0]?.paragraphs).toEqual([
    '',
    '正文位置',
    '',
    '',
  ]);
  await restoreBackup(legacy.backup, preparedLegacy, 'overwrite');
  await expect(
    restoreBackup(modern.backup, preparedModern, 'merge'),
  ).rejects.toThrow('段落结构版本不同');
  expect((await db.books.get(legacy.parsed.id))?.parserVersion).toBe(2);
  expect((await db.progress.get(legacy.parsed.id))?.locator).toEqual(
    legacy.backup.backup.progress[0]?.locator,
  );
  expect((await db.highlights.get('svg-note'))?.start.paragraphIndex).toBe(0);
  const file = new File([await buildArchive(modern.backup)], 'v3.zip');
  const read = await readBackup(file);
  const archive = await BackupArchive.open(file);
  const prepared = [await archive.prepare(read.books[0]!.id)];
  await archive.verifyRemaining();
  await restoreBackup({ backup: read }, prepared, 'overwrite');
  expect((await db.books.get(modern.parsed.id))?.parserVersion).toBe(3);
  expect((await db.highlights.get('svg-note'))?.start.paragraphIndex).toBe(1);
  expect((await db.bookmarks.get('svg-bookmark'))?.locator.paragraphIndex).toBe(
    1,
  );
  expect((await db.chapters.get([modern.parsed.id, 0]))?.paragraphs).toEqual(
    modern.parsed.chapters[0]?.paragraphs,
  );
});
