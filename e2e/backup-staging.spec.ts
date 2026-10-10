import { test, expect } from './fixtures';
import { openShelf } from './helpers';
import { updateData } from './updateData';
import { fixturePayload } from '../src/backup/fixtures';
import { buildArchive } from '../src/backup/archive';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { parseText } from '../src/parsers/file';
import { sourcePath } from '../src/backup/types';
import type { Page } from '@playwright/test';

async function stageKeys(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jingye');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db
          .transaction('blobs')
          .objectStore('blobs')
          .getAllKeys(
            IDBKeyRange.bound('restore-stage:', 'restore-stage:\uffff'),
          );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
async function inspect(page: Page, bytes: Buffer) {
  await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
    name: '原创恢复.zip',
    mimeType: 'application/zip',
    buffer: bytes,
  });
  await expect(
    page.getByRole('heading', { name: '恢复备份', exact: true }),
  ).toBeVisible();
}
async function overwrite(page: Page) {
  await page.getByRole('radio', { name: '覆盖', exact: true }).check();
  await page.getByLabel('我确认按此备份覆盖本机数据').check();
  await page.getByRole('button', { name: '覆盖恢复', exact: true }).click();
}

test('完整备份逐书暂存恢复及流式导出，十三份原文SHA保留', async ({
  page,
}, info) => {
  const payload = await fixturePayload(12);
  const first = payload.backup.books[0]!;
  const longSource = new Blob([
    await payload.originals[0]!.data.text(),
    '\n\n',
    '长篇原创备份正文，保留每个字符。'.repeat(25_000),
  ]);
  expect(longSource.size).toBeGreaterThan(1024 * 1024);
  const parsed = await parseText(await longSource.arrayBuffer());
  const changed = {
    ...first,
    id: parsed.id,
    size: longSource.size,
    charCount: parsed.charCount,
    chapterCount: parsed.chapters.length,
  };
  payload.backup.books[0] = changed;
  payload.originals[0] = { bookId: parsed.id, data: longSource };
  payload.backup.files[0] = { bookId: parsed.id, path: sourcePath(changed) };
  for (const row of [
    ...payload.backup.progress,
    ...payload.backup.bookmarks,
    ...payload.backup.highlights,
  ])
    if (row.bookId === first.id) row.bookId = parsed.id;
  payload.backup.settings.lastBookId = parsed.id;
  const bytes = Buffer.from(await (await buildArchive(payload)).arrayBuffer());
  await page.addInitScript(() => {
    const events: string[] = [];
    const replies: {
      kind: string;
      books: number;
      files?: number;
      blobs: number;
      bookId?: string;
    }[] = [];
    const exports: {
      inputBlobs: number;
      sourceReadsAtStart: number;
      fileIds: string[];
    }[] = [];
    const sourceReads: string[] = [];
    Object.assign(window, {
      restoreWrites: events,
      backupReplies: replies,
      backupExports: exports,
      backupSourceReads: sourceReads,
    });
    const countBlobs = (value: unknown): number => {
      if (value instanceof Blob) return 1;
      if (!value || typeof value !== 'object') return 0;
      return Object.values(value).reduce<number>(
        (sum, item: unknown) => sum + countBlobs(item),
        0,
      );
    };
    const nativeWorker = window.Worker;
    window.Worker = new Proxy(nativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(target, receiver, args) {
            const message: unknown = args[0];
            if (
              message &&
              typeof message === 'object' &&
              'type' in message &&
              message.type === 'APPLY' &&
              'path' in message &&
              Array.isArray(message.path) &&
              message.path.includes('buildSnapshotArchive') &&
              'argumentList' in message &&
              Array.isArray(message.argumentList)
            ) {
              const first: unknown = message.argumentList[0];
              if (first && typeof first === 'object' && 'value' in first) {
                const input = first.value;
                if (
                  input &&
                  typeof input === 'object' &&
                  'files' in input &&
                  Array.isArray(input.files)
                )
                  exports.push({
                    inputBlobs: countBlobs(input),
                    sourceReadsAtStart: sourceReads.length,
                    fileIds: input.files.map(
                      (file: { bookId: string }) => file.bookId,
                    ),
                  });
              }
            }
            return Reflect.apply(target, receiver, args);
          },
        });
        worker.addEventListener('message', (event: MessageEvent<unknown>) => {
          const response = event.data;
          if (
            !response ||
            typeof response !== 'object' ||
            !('value' in response)
          )
            return;
          const value = response.value;
          if (!value || typeof value !== 'object') return;
          if (
            'app' in value &&
            value.app === 'jingye' &&
            'books' in value &&
            Array.isArray(value.books) &&
            'files' in value &&
            Array.isArray(value.files)
          ) {
            replies.push({
              kind: 'preview',
              books: value.books.length,
              files: value.files.length,
              blobs: countBlobs(value),
            });
          } else if (
            'book' in value &&
            value.book &&
            typeof value.book === 'object' &&
            'id' in value.book &&
            typeof value.book.id === 'string'
          ) {
            replies.push({
              kind: 'prepared',
              books: 1,
              bookId: value.book.id,
              blobs: countBlobs(value),
            });
          }
        });
        return worker;
      },
    });
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key);
      if (
        this.name === 'blobs' &&
        typeof key === 'string' &&
        /^(?:[a-f0-9]{64}|paste:[a-f0-9]{64}:draft)$/.test(key)
      )
        request.addEventListener('success', () => {
          const value: unknown = request.result;
          if (
            value &&
            typeof value === 'object' &&
            'data' in value &&
            value.data instanceof Blob
          )
            sourceReads.push(key);
        });
      return request;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string'
      ) {
        const id = value.id;
        if (
          this.name === 'books' ||
          (this.name === 'blobs' && id.startsWith('restore-stage:'))
        ) {
          const kind = this.name === 'books' ? 'book' : 'stage';
          request.addEventListener('success', () =>
            events.push(kind + ':' + id),
          );
        }
      }
      return request;
    };
  });
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  await inspect(page, bytes);
  await expect(
    page.getByText(/13 本书 · 1 个书签 · 1 条划线笔记 · 13 份原文/),
  ).toBeVisible();
  const previewReplies = await page.evaluate(
    () =>
      (
        window as unknown as {
          backupReplies: {
            kind: string;
            books: number;
            files?: number;
            blobs: number;
          }[];
        }
      ).backupReplies,
  );
  expect(previewReplies).toEqual([
    { kind: 'preview', books: 13, files: 13, blobs: 0 },
  ]);
  expect(await stageKeys(page)).toEqual([]);
  await overwrite(page);
  await expect(
    page.getByText('恢复完成。书架共 13 本。', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => stageKeys(page)).toEqual([]);
  const events = await page.evaluate(
    () => (window as unknown as { restoreWrites: string[] }).restoreWrites,
  );
  expect(events.slice(0, 13).every((event) => event.startsWith('stage:'))).toBe(
    true,
  );
  expect(events.filter((event) => event.startsWith('stage:'))).toHaveLength(13);
  expect(events.slice(13).every((event) => event.startsWith('book:'))).toBe(
    true,
  );
  const preparedReplies = await page.evaluate(() =>
    (
      window as unknown as {
        backupReplies: {
          kind: string;
          bookId?: string;
          books: number;
          blobs: number;
        }[];
      }
    ).backupReplies.filter((reply) => reply.kind === 'prepared'),
  );
  expect(preparedReplies.map((reply) => reply.bookId)).toEqual(
    payload.backup.files.map((source) => source.bookId),
  );
  expect(
    preparedReplies.every((reply) => reply.books === 1 && reply.blobs === 1),
  ).toBe(true);
  const data = await updateData(page);
  expect(data.books).toHaveLength(13);
  expect(data.bookmarks).toEqual(payload.backup.bookmarks);
  expect(data.highlights).toEqual(payload.backup.highlights);
  for (const original of payload.originals)
    expect(data.blobs).toContainEqual(
      expect.objectContaining({
        sha256: createHash('sha256')
          .update(Buffer.from(await original.data.arrayBuffer()))
          .digest('hex'),
      }),
    );
  await page.reload();
  expect(await stageKeys(page)).toEqual([]);
  expect((await updateData(page)).books).toEqual(data.books);
  await page.getByRole('button', { name: '跳过引导', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '设置', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '生成完整备份', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  const download = await downloading;
  const exportEvidence = await page.evaluate(() => {
    const observed = window as unknown as {
      backupExports: {
        inputBlobs: number;
        sourceReadsAtStart: number;
        fileIds: string[];
      }[];
      backupSourceReads: string[];
    };
    return {
      calls: observed.backupExports,
      sourceReads: observed.backupSourceReads,
    };
  });
  expect(exportEvidence.calls).toHaveLength(1);
  expect(exportEvidence.calls[0]).toMatchObject({
    inputBlobs: 0,
    sourceReadsAtStart: 0,
  });
  expect(exportEvidence.calls[0]!.fileIds).toHaveLength(13);
  expect(exportEvidence.sourceReads).toEqual(
    exportEvidence.calls[0]!.fileIds.map((id) =>
      id.startsWith('paste:') ? `${id}:draft` : id,
    ),
  );
  const directory = resolve('test-books/generated-backups');
  await mkdir(directory, { recursive: true });
  const zipPath = resolve(
    directory,
    `${info.project.name}-${randomUUID()}.zip`,
  );
  await download.saveAs(zipPath);
  const exported = await readFile(zipPath);
  const archive = await JSZip.loadAsync(exported, { checkCRC32: true });
  expect(Object.keys(archive.files)).toHaveLength(14);
  const expectedFiles = [];
  for (const original of payload.originals) {
    const path = payload.backup.files.find(
      (file) => file.bookId === original.bookId,
    )!.path;
    const expected = Buffer.from(await original.data.arrayBuffer());
    expect(Buffer.from(await archive.file(path)!.async('uint8array'))).toEqual(
      expected,
    );
    expectedFiles.push({
      path,
      size: expected.length,
      sha256: createHash('sha256').update(expected).digest('hex'),
    });
  }
  const metadata: unknown = JSON.parse(
    await archive.file('backup.json')!.async('string'),
  );
  expect(metadata).toMatchObject({
    app: 'jingye',
    kind: 'full',
    bookmarks: payload.backup.bookmarks,
    highlights: payload.backup.highlights,
  });
  const exportedBooks = (metadata as { books: Record<string, unknown>[] })
    .books;
  expect(exportedBooks).toHaveLength(13);
  for (const book of exportedBooks)
    for (const field of [
      'toc',
      'chapterSummaries',
      'fileBlobId',
      'coverBlobId',
      'draftBlobId',
    ])
      expect(book).not.toHaveProperty(field);
  await mkdir('artifacts/backup-export-browser', { recursive: true });
  await writeFile(
    `artifacts/backup-export-browser/${info.project.name}.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        engine: info.project.name,
        zipPath,
        zipBytes: exported.length,
        zipSha256: createHash('sha256').update(exported).digest('hex'),
        nativeDownload: true,
        originalsEqual: true,
        workerPreviewOnlyMetadata: true,
        preparedRepliesEachSingleBook: true,
        exportInputOnlyMetadata: true,
        sourceReadsAfterWorkerStart: true,
        sourceBytes: longSource.size,
        physicalDeviceOrPeakRamAcceptance: false,
        files: expectedFiles,
      },
      null,
      2,
    ) + '\n',
  );
});

test('最后一本位置校验失败时整库回滚并清除暂存，原页面可以重新选择备份恢复', async ({
  page,
}) => {
  const payload = await fixturePayload(3, false);
  const invalid = {
    ...payload,
    backup: {
      ...payload.backup,
      progress: [
        {
          ...payload.backup.progress[0]!,
          bookId: payload.backup.books.at(-1)!.id,
          locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 999 },
        },
      ],
    },
  };
  await openShelf(page);
  await page.getByRole('button', { name: '设置与数据管理' }).click();
  const before = await updateData(page);
  await inspect(
    page,
    Buffer.from(await (await buildArchive(invalid)).arrayBuffer()),
  );
  await overwrite(page);
  await expect(
    page.getByRole('alert').filter({ hasText: '备份中的位置与原文不一致' }),
  ).toBeVisible();
  await expect.poll(() => stageKeys(page)).toEqual([]);
  expect(await updateData(page)).toEqual(before);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await inspect(
    page,
    Buffer.from(await (await buildArchive(payload)).arrayBuffer()),
  );
  await page.getByRole('button', { name: '合并恢复', exact: true }).click();
  await expect(
    page.getByText('恢复完成。书架共 3 本。', { exact: true }),
  ).toBeVisible();
  expect(await stageKeys(page)).toEqual([]);
});
