import { parseText } from '@/parsers/file';
import { parseDraft } from '@/parsers/paste';
import { initialSettings } from '@/app/defaults';
import { db } from '@/db';
import { createSnapshot, readSnapshotOriginal } from './snapshot';
import {
  BACKUP_VERSION,
  sourcePath,
  type BackupPayload,
  type PreparedBook,
} from './types';
/** 自编样本，仅在测试中使用。 */
export async function snapshotPayload(
  kind: 'light' | 'full',
  database = db,
): Promise<BackupPayload> {
  const snapshot = await createSnapshot(kind, database);
  const originals = [];
  for (const source of snapshot.sources)
    originals.push({
      bookId: source.bookId,
      data: await readSnapshotOriginal(source, database),
    });
  return { backup: snapshot.backup, originals };
}
export async function fixturePayload(
  count = 2,
  includeDraft = true,
): Promise<BackupPayload> {
  const books = [],
    originals = [];
  for (let index = 0; index < count; index++) {
    const text = `第一章 静夜${index}\n甲乙丙丁戊己庚辛壬癸\n第二段春风纸页。\n第二章 晨光${index}\n清晨又翻开一页。`;
    const data = new Blob([text]),
      parsed = await parseText(await data.arrayBuffer());
    books.push({
      id: parsed.id,
      title: `测试书${index}`,
      type: 'txt' as const,
      size: data.size,
      charCount: parsed.charCount,
      chapterCount: parsed.chapters.length,
      importedAt: 100 + index,
      lastReadAt: index === 0 ? 300 : 200,
      settingsOverride: { fontSize: 22, theme: 'green' as const },
    });
    originals.push({ bookId: parsed.id, data });
  }
  if (includeDraft) {
    const text = '# 文稿\n保留原始文稿的空行。\n\n## 子节\n下一页文字。',
      data = new Blob([text]);
    const parsed = await parseDraft(text);
    books.push({
      id: parsed.id,
      title: '自编文稿',
      type: 'paste' as const,
      size: data.size,
      charCount: parsed.charCount,
      chapterCount: parsed.chapters.length,
      importedAt: 120,
      lastReadAt: 210,
      settingsOverride: { fontSize: 22, theme: 'green' as const },
    });
    originals.push({ bookId: parsed.id, data });
  }
  const id = books[0]!.id,
    settings = { ...initialSettings(), lastBookId: id, autoResume: true };
  settings.reading.theme = 'night';
  return {
    originals,
    backup: {
      app: 'jingye',
      schemaVersion: BACKUP_VERSION,
      exportedAt: 1000,
      kind: 'full',
      books,
      files: books.map((book) => ({ bookId: book.id, path: sourcePath(book) })),
      settings,
      progress: [
        {
          bookId: id,
          locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 2 },
          percent: 5,
          updatedAt: 300,
        },
      ],
      bookmarks: [
        {
          id: 'bookmark-a',
          bookId: id,
          locator: { chapterIndex: 0, paragraphIndex: 1, charOffset: 0 },
          chapterTitle: '第一章',
          excerpt: '第二段',
          createdAt: 250,
        },
      ],
      highlights: [
        {
          id: 'highlight-a',
          bookId: id,
          chapterIndex: 0,
          start: { paragraphIndex: 0, charOffset: 1 },
          end: { paragraphIndex: 0, charOffset: 4 },
          text: '乙丙丁',
          color: 'blue',
          note: '安静的摘录',
          createdAt: 220,
          updatedAt: 280,
        },
      ],
    },
  };
}
export async function seed(
  database: ReturnType<typeof import('@/db/schema').createDatabase>,
  prepared: PreparedBook[],
  payload: BackupPayload,
) {
  await database.books.bulkPut(prepared.map((p) => p.book));
  await database.chapters.bulkPut(prepared.flatMap((p) => p.chapters));
  await database.blobs.bulkPut(prepared.flatMap((p) => p.blobs));
  await database.progress.bulkPut(payload.backup.progress);
  await database.bookmarks.bulkPut(payload.backup.bookmarks);
  await database.highlights.bulkPut(payload.backup.highlights);
  await database.settings.put({ id: 'global', value: payload.backup.settings });
}
