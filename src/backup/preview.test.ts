import JSZip from 'jszip';
import { expect, it, vi } from 'vitest';
import { fixturePayload } from './fixtures';
import {
  BackupArchive,
  buildArchive,
  createArchiveRestoreApi,
  readBackup,
} from './archive';
import { BoundedZip } from '@/parsers/zip';

it('十三本预览只返回元数据，原文和未引用条目逐块校验后丢弃', async () => {
  const payload = await fixturePayload(12);
  const zip = await JSZip.loadAsync(
    await (await buildArchive(payload)).arrayBuffer(),
  );
  zip.file('unused.txt', '未引用条目也必须校验');
  const file = new File(
    [await zip.generateAsync({ type: 'arraybuffer' })],
    'full.zip',
  );
  const whole = vi
    .spyOn(file, 'arrayBuffer')
    .mockRejectedValue(new Error('must slice'));
  const reads = vi.spyOn(BoundedZip.prototype, 'read');
  try {
    const backup = await readBackup(file);
    expect(backup.books).toHaveLength(13);
    expect(backup.files).toHaveLength(13);
    expect(backup).not.toHaveProperty('originals');
    const originals = reads.mock.calls.filter(([path]) =>
      path.startsWith('books/'),
    );
    expect(originals).toHaveLength(13);
    expect(originals.every(([, , discard]) => discard === true)).toBe(true);
    expect(reads.mock.calls).toContainEqual(['unused.txt', undefined, true]);
    expect(whole).not.toHaveBeenCalled();
  } finally {
    reads.mockRestore();
  }
});

it('恢复重新打开一次目录且逐次仅展开指定原文，拒绝重复或无关书，结束后不再持有会话', async () => {
  const payload = await fixturePayload(3, false);
  const file = new File([await buildArchive(payload)], 'full.zip');
  const backup = await readBackup(file);
  const api = createArchiveRestoreApi();
  const reads = vi.spyOn(BoundedZip.prototype, 'read');
  try {
    await api.openRestore({ backup, archive: file });
    expect(reads.mock.calls.map(([path]) => path)).toEqual(['backup.json']);
    await expect(api.prepareRestoreBook('unrelated')).rejects.toThrow('不一致');
    for (const [index, source] of backup.files.entries()) {
      const prepared = await api.prepareRestoreBook(source.bookId);
      expect(prepared.book.id).toBe(source.bookId);
      expect(await prepared.blobs[0]!.data.text()).toBe(
        await payload.originals[index]!.data.text(),
      );
      expect(reads.mock.calls.map(([path]) => path)).toEqual([
        'backup.json',
        ...backup.files.slice(0, index + 1).map((file) => file.path),
      ]);
    }
    await expect(
      api.prepareRestoreBook(backup.files[0]!.bookId),
    ).rejects.toThrow('重复');
    await api.finishRestore();
    await expect(
      api.prepareRestoreBook(backup.files[0]!.bookId),
    ).rejects.toThrow('不可用');
  } finally {
    reads.mockRestore();
  }
});

it('预览与重新读取元数据不一致或缺少原始备份File时拒绝，重新选择正确文件可重试', async () => {
  const payload = await fixturePayload(1, false);
  const file = new File([await buildArchive(payload)], 'full.zip');
  const backup = await readBackup(file);
  const api = createArchiveRestoreApi();
  await expect(api.openRestore({ backup })).rejects.toThrow('不可用');
  await expect(
    api.openRestore({
      backup: {
        ...backup,
        books: [{ ...backup.books[0]!, title: '预览后改变书名' }],
      },
      archive: file,
    }),
  ).rejects.toThrow('预览不一致');
  await expect(api.prepareRestoreBook(backup.books[0]!.id)).rejects.toThrow(
    '不可用',
  );
  await api.openRestore({ backup, archive: file });
  expect((await api.prepareRestoreBook(backup.books[0]!.id)).book.id).toBe(
    backup.books[0]!.id,
  );
  await api.finishRestore();
});

it('多个恢复会话保留独立目录和读取记录，不复用预览已经耗用的解压预算', async () => {
  const payload = await fixturePayload(2, false);
  const file = new File([await buildArchive(payload)], 'full.zip');
  const backup = await readBackup(file);
  const first = createArchiveRestoreApi(),
    second = createArchiveRestoreApi();
  await first.openRestore({ backup, archive: file });
  await second.openRestore({ backup, archive: file });
  for (const source of backup.files) {
    const a = await first.prepareRestoreBook(source.bookId);
    const b = await second.prepareRestoreBook(source.bookId);
    expect(a.chapters).toEqual(b.chapters);
  }
  await first.finishRestore();
  await second.finishRestore();
  const fresh = await BackupArchive.open(file);
  expect((await fresh.prepare(backup.books[0]!.id)).book.id).toBe(
    backup.books[0]!.id,
  );
});
