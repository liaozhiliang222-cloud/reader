import JSZip from 'jszip';
import { expect, it } from 'vitest';
import {
  BackupArchive,
  buildArchive,
  prepareBooks,
  readBackup,
} from './archive';
import { BoundedZip } from '@/parsers/zip';
import { fixturePayload } from './fixtures';
import { BACKUP_METADATA_LIMIT } from './limits';
import { vi } from 'vitest';
it('10本原文件和文稿可解压，ZIP再读/解析后指纹、正文和类型一致', async () => {
  const payload = await fixturePayload(10),
    progress: number[] = [];
  const blob = await buildArchive(payload, (p) => progress.push(p.percent));
  if (process.env.JINGYE_WRITE_BACKUP_FIXTURE === '1') {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const directory = resolve('test-books/generated-backups');
    await mkdir(directory, { recursive: true });
    const path = resolve(
      directory,
      `backup-10books-${crypto.randomUUID()}.zip`,
    );
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()), {
      flag: 'wx',
    });
    console.log(`自编完整备份素材：${path}`);
  }
  const zip = await JSZip.loadAsync(await blob.arrayBuffer(), {
    checkCRC32: true,
  });
  expect(zip.file('backup.json')).not.toBeNull();
  expect(
    Object.values(zip.files).filter(
      (f) => !f.dir && f.name.startsWith('books/'),
    ),
  ).toHaveLength(11);
  for (const original of payload.originals) {
    const path = payload.backup.files.find(
      (f) => f.bookId === original.bookId,
    )!.path;
    expect(path).not.toContain('paste:');
    expect(await zip.file(path)!.async('string')).toBe(
      await original.data.text(),
    );
  }
  expect(progress.at(-1)).toBe(100);
  const file = new File([blob], '静页备份.zip');
  const read = await readBackup(file);
  expect(read.books).toHaveLength(11);
  expect(read).not.toHaveProperty('originals');
  const archive = await BackupArchive.open(file);
  const prepared = [];
  for (const source of read.files)
    prepared.push(await archive.prepare(source.bookId));
  await archive.verifyRemaining();
  expect(prepared.map((p) => p.book.id)).toEqual(
    payload.backup.books.map((b) => b.id),
  );
  expect(prepared.at(-1)?.book.draftBlobId).toBe(
    payload.backup.books.at(-1)!.id + ':draft',
  );
  expect(prepared[0]?.chapters[0]?.paragraphs[0]).toBe('甲乙丙丁戊己庚辛壬癸');
});
it('元数据上限在整体读取和解压前执行；引用与未使用文件均核对 CRC', async () => {
  const oversized = new File(
    [new Uint8Array(BACKUP_METADATA_LIMIT + 1)],
    'too-large.json',
  );
  const read = vi
    .spyOn(oversized, 'arrayBuffer')
    .mockRejectedValue(new Error('must not read'));
  await expect(readBackup(oversized)).rejects.toThrow('32 MiB');
  expect(read).not.toHaveBeenCalled();
  const zip = new JSZip().file(
    'backup.json',
    ' '.repeat(BACKUP_METADATA_LIMIT + 1),
  );
  await expect(
    readBackup(
      new File(
        [
          await zip.generateAsync({
            type: 'arraybuffer',
            compression: 'DEFLATE',
          }),
        ],
        'json-bomb.zip',
      ),
    ),
  ).rejects.toThrow('大小超限');
  const payload = await fixturePayload(1);
  const full = await buildArchive(payload);
  const file = new File([full], 'full.zip');
  const whole = vi
    .spyOn(file, 'arrayBuffer')
    .mockRejectedValue(new Error('must slice'));
  const reads = vi.spyOn(BoundedZip.prototype, 'read');
  expect((await readBackup(file)).files).toHaveLength(payload.originals.length);
  const originalsRead = reads.mock.calls.filter(([path]) =>
    path.startsWith('books/'),
  );
  expect(originalsRead).toHaveLength(payload.originals.length);
  expect(originalsRead.every(([, , discard]) => discard === true)).toBe(true);
  reads.mockRestore();
  expect(whole).not.toHaveBeenCalled();
  // Corrupt an unused empty entry's original CRC, which JSZip discards on load.
  const extra = new JSZip()
    .file(
      'backup.json',
      JSON.stringify({ ...payload.backup, kind: 'light', files: [] }),
    )
    .file('unused', '');
  const buffer = await extra.generateAsync({ type: 'arraybuffer' }),
    view = new DataView(buffer);
  const end = buffer.byteLength - 22;
  for (let at = view.getUint32(end + 16, true); at < end;) {
    const nameLength = view.getUint16(at + 28, true),
      name = new TextDecoder().decode(
        new Uint8Array(buffer, at + 46, nameLength),
      );
    if (name === 'unused') {
      view.setUint32(at + 16, 1, true);
      view.setUint32(view.getUint32(at + 42, true) + 14, 1, true);
    }
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  await expect(
    readBackup(new File([buffer], 'corrupt-unused.zip')),
  ).rejects.toThrow('CRC');
});
it('JSON只恢复元数据；缺文件、错误大小、原文指纹错、损坏包均失败', async () => {
  const payload = await fixturePayload();
  await expect(readBackup(new File(['broken'], 'bad.zip'))).rejects.toThrow(
    'ZIP',
  );
  await expect(
    readBackup(new File([JSON.stringify(payload.backup)], 'metadata.json')),
  ).rejects.toThrow('ZIP');
  const light = { ...payload.backup, kind: 'light', files: [] };
  expect(
    (await readBackup(new File([JSON.stringify(light)], 'light.json'))).files,
  ).toEqual([]);
  const zip = new JSZip().file('backup.json', JSON.stringify(payload.backup));
  await expect(
    readBackup(
      new File(
        [await zip.generateAsync({ type: 'arraybuffer' })],
        'missing.zip',
      ),
    ),
  ).rejects.toThrow('缺失');
  const changed = {
    ...payload,
    originals: [
      {
        ...payload.originals[0]!,
        data: new Blob(['字'.repeat(payload.originals[0]!.data.size / 3)]),
      },
      ...payload.originals.slice(1),
    ],
  };
  const original = payload.originals[0]!.data,
    bytes = new Uint8Array(await original.arrayBuffer());
  bytes[0] = bytes[0]! ^ 1;
  changed.originals[0]!.data = new Blob([bytes]);
  await expect(prepareBooks(changed)).rejects.toThrow('指纹');
  zip.file(payload.backup.files[0]!.path, 'too small');
  await expect(
    readBackup(
      new File([await zip.generateAsync({ type: 'arraybuffer' })], 'size.zip'),
    ),
  ).rejects.toThrow('不完整');
  const oversized = new JSZip().file(
    'backup.json',
    JSON.stringify(payload.backup),
  );
  oversized.file(
    payload.backup.files[0]!.path,
    new Uint8Array(payload.backup.books[0]!.size + 10),
  );
  await expect(
    readBackup(
      new File(
        [
          await oversized.generateAsync({
            type: 'arraybuffer',
            compression: 'DEFLATE',
          }),
        ],
        'oversized.zip',
      ),
    ),
  ).rejects.toThrow('大小');
  const traversal = new JSZip().file(
    'backup.json',
    JSON.stringify(payload.backup),
  );
  traversal.file(
    '../' + payload.backup.files[0]!.path,
    await payload.originals[0]!.data.arrayBuffer(),
  );
  await expect(
    readBackup(
      new File(
        [await traversal.generateAsync({ type: 'arraybuffer' })],
        'traversal.zip',
      ),
    ),
  ).rejects.toThrow('路径');
});
