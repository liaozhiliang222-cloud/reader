import { expect, it } from 'vitest';
import { validateBackup, parseBackupJson, validateReading } from './validate';
import { newest } from './merge';
import { fixturePayload } from './fixtures';
it('关闭提醒只作用于记录的周期，备份白名单保留时间和周期，非法值拒绝', async () => {
  const { backup } = await fixturePayload();
  const result = validateBackup({
    ...backup,
    settings: {
      lastBackupAt: 1000,
      backupReminderDismissed: { baseline: 1000, cycle: 1 },
    },
  });
  expect(result.settings).toMatchObject({
    lastBackupAt: 1000,
    backupReminderDismissed: { baseline: 1000, cycle: 1 },
  });
  expect(parseBackupJson(JSON.stringify(result))).toEqual(result);
  expect(() =>
    validateBackup({
      ...backup,
      settings: { backupReminderDismissed: { baseline: 0, cycle: -1 } },
    }),
  ).toThrow('周期');
  expect(() =>
    validateBackup({ ...backup, settings: { backupReminderDismissed: 'all' } }),
  ).toThrow('关闭状态');
});
it('浅色主题历史与跟随开关可往返，非法主题或非布尔开关拒绝', async () => {
  const { backup } = await fixturePayload();
  const result = validateBackup({
    ...backup,
    settings: {
      followSystemTheme: true,
      reading: { theme: 'night', lightTheme: 'green' },
    },
  });
  expect(result.settings).toMatchObject({
    followSystemTheme: true,
    reading: { theme: 'night', lightTheme: 'green' },
  });
  expect(parseBackupJson(JSON.stringify(result))).toEqual(result);
  expect(() => validateReading({ lightTheme: 'night' })).toThrow('浅色主题');
  expect(() =>
    validateBackup({ ...backup, settings: { followSystemTheme: 'true' } }),
  ).toThrow('followSystemTheme');
});
it('旧备份补安静提示默认值，新备份保留关闭值，非布尔值拒绝', async () => {
  const { backup } = await fixturePayload();
  expect(
    validateBackup({ ...backup, settings: { reading: { fontSize: 18 } } })
      .settings.reading.quietHint,
  ).toBe(true);
  expect(
    validateBackup({ ...backup, settings: { reading: { quietHint: false } } })
      .settings.reading.quietHint,
  ).toBe(false);
  expect(() => validateReading({ quietHint: 'false' })).toThrow('quietHint');
});
it('开放 JSON 格式可读，白名单过滤本机 Blob 引用与原型字段', async () => {
  const { backup } = await fixturePayload();
  const value = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
  value.unknown = 'ignored';
  const book = (value.books as Record<string, unknown>[])[0]!;
  book.fileBlobId = 'foreign';
  book.coverBlobId = 'foreign';
  book.draftBlobId = 'foreign';
  const parsed = validateBackup(value);
  expect(parsed.books[0]).not.toHaveProperty('fileBlobId');
  expect(parsed.books[0]).not.toHaveProperty('coverBlobId');
  expect(parseBackupJson(JSON.stringify(parsed))).toEqual(parsed);
  expect(
    validateBackup({
      ...backup,
      settings: JSON.parse(
        '{"reading":{"__proto__":{"polluted":true},"fontSize":20}}',
      ),
    }).settings.reading.fontSize,
  ).toBe(20);
  expect({}).not.toHaveProperty('polluted');
});
it('拒绝错误app/版本、非法位置/主题、重复ID、孤立标注和危险原文路径', async () => {
  const { backup } = await fixturePayload();
  expect(() => parseBackupJson('{')).toThrow('JSON');
  expect(() => validateBackup({ ...backup, app: 'another' })).toThrow(
    '不是静页',
  );
  expect(() => validateBackup({ ...backup, schemaVersion: 999 })).toThrow(
    '版本',
  );
  expect(() =>
    validateBackup({ ...backup, books: [backup.books[0], backup.books[0]] }),
  ).toThrow('重复');
  expect(() =>
    validateBackup({
      ...backup,
      progress: [{ ...backup.progress[0], percent: Infinity }],
    }),
  ).toThrow('百分比');
  expect(() =>
    validateBackup({
      ...backup,
      progress: [
        {
          ...backup.progress[0],
          locator: { chapterIndex: 999, paragraphIndex: 0, charOffset: 0 },
        },
      ],
    }),
  ).toThrow('章节');
  expect(() =>
    validateBackup({
      ...backup,
      highlights: [{ ...backup.highlights[0], bookId: '0'.repeat(64) }],
    }),
  ).toThrow('不存在');
  expect(() =>
    validateBackup({
      ...backup,
      highlights: [
        { ...backup.highlights[0], end: backup.highlights[0]!.start },
      ],
    }),
  ).toThrow('范围');
  expect(() =>
    validateBackup({
      ...backup,
      settings: {
        ...backup.settings,
        reading: { ...backup.settings.reading, fontSize: 300 },
      },
    }),
  ).toThrow('字号');
  expect(() =>
    validateBackup({
      ...backup,
      files: [{ ...backup.files[0], path: '../book.txt' }],
    }),
  ).toThrow('路径');
  expect(() => validateBackup({ ...backup, kind: 'light' })).toThrow('轻量');
});
it('按时间合并，平局保留本机，不把相同标注ID挂到其他书，不修改输入', () => {
  const local = { id: 'a', bookId: 'one', updatedAt: 30, note: '本机' };
  expect(
    newest(
      local,
      { ...local, updatedAt: 20, note: '旧备份' },
      (r) => r.updatedAt,
    ),
  ).toBe(local);
  expect(
    newest(local, { ...local, note: '相同时间' }, (r) => r.updatedAt),
  ).toBe(local);
  expect(
    newest(
      local,
      { ...local, updatedAt: 40, note: '新备份' },
      (r) => r.updatedAt,
    ).note,
  ).toBe('新备份');
  expect(() =>
    newest(local, { ...local, bookId: 'two' }, (r) => r.updatedAt),
  ).toThrow('冲突');
  expect(local.note).toBe('本机');
});
