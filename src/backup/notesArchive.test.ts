import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { fixturePayload } from './fixtures';
import { validateBackup } from './validate';
import { restoreBackup } from './restore';
import { createDatabase } from '@/db/schema';
import { createSnapshot } from './snapshot';
it('删书保留摘录独立往返备份，标签和回顾标记不丢，旧备份版本拒绝', async () => {
  const payload = await fixturePayload(1, false);
  const note = payload.backup.highlights[0]!;
  const backup = {
    ...payload.backup,
    kind: 'light' as const,
    books: [],
    progress: [],
    bookmarks: [],
    files: [],
    highlights: [
      {
        ...note,
        unanchored: true,
        archivedSource: { title: '原书名', chapterTitle: '第一章' },
        tags: ['回顾'],
        reviewPending: true,
      },
    ],
  };
  backup.settings.lastBookId = undefined;
  expect(validateBackup(backup).highlights[0]?.archivedSource?.title).toBe(
    '原书名',
  );
  expect(() => validateBackup({ ...backup, schemaVersion: 4 })).toThrow(
    '保留摘录',
  );
  const database = createDatabase('archive-' + crypto.randomUUID());
  try {
    await restoreBackup({ backup }, [], 'overwrite', database);
    expect(await database.books.count()).toBe(0);
    const exported = await createSnapshot('light', database);
    expect(validateBackup(exported.backup).highlights).toEqual(
      validateBackup(backup).highlights,
    );
  } finally {
    await database.delete();
  }
});
it('原文件指纹和未来身份版本不一致时拒绝恢复', async () => {
  const { backup } = await fixturePayload(1, false);
  expect(() =>
    validateBackup({
      ...backup,
      books: [{ ...backup.books[0], identityVersion: 9 }],
    }),
  ).toThrow('身份版本');
  expect(() =>
    validateBackup({
      ...backup,
      books: [{ ...backup.books[0], sourceFingerprint: 'f'.repeat(64) }],
    }),
  ).toThrow('指纹');
});
