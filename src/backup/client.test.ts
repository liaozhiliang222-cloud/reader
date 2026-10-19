import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { fixturePayload, seed } from './fixtures';
import JSZip from 'jszip';
import type { BackupFile } from './types';
const controls = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  finish: vi.fn(),
  release: vi.fn(),
  key: Symbol('release'),
}));
vi.mock('comlink', () => ({
  proxy: <T>(fn: T) => fn,
  releaseProxy: controls.key,
  wrap: () => ({
    openRestore: controls.open,
    prepareRestoreBook: controls.invoke,
    finishRestore: controls.finish,
    buildSnapshotArchive: controls.invoke,
    readBackup: controls.invoke,
    [controls.key]: controls.release,
  }),
}));
import { generateFullBackup, inspectBackup, restoreFromBackup } from './client';
import { db } from '@/db';
import {
  buildArchive,
  buildSnapshotArchive,
  createArchiveRestoreApi,
  prepareBooks,
  readBackup,
} from './archive';
import { scanZip } from '@/parsers/zipDirectory';
import { snapshotPayload as createSnapshot } from './fixtures';
import { createSnapshot as exportSnapshot } from './snapshot';
import { RESTORE_PREFIX } from './staging';
const workers: WorkerStub[] = [];
class WorkerStub extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    super();
    workers.push(this);
  }
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  controls.invoke.mockReset();
  controls.open.mockReset();
  controls.finish.mockReset();
  controls.release.mockReset();
  workers.length = 0;
  await db.delete();
});

it('导出RPC只有元数据和逐书供给回调，实际供给生成的ZIP可读取，线程正常释放', async () => {
  await db.open();
  const payload = await fixturePayload(2);
  await seed(db, await prepareBooks(payload), payload);
  const snapshot = await exportSnapshot('full');
  vi.stubGlobal('Worker', WorkerStub);
  controls.invoke.mockImplementation(buildSnapshotArchive);
  const archive = await generateFullBackup(snapshot, () => {});
  expect(controls.invoke.mock.calls[0]![0]).toBe(snapshot.backup);
  expect(controls.invoke.mock.calls[0]![0]).not.toHaveProperty('originals');
  expect(await readBackup(new File([archive], 'full.zip'))).toEqual(
    snapshot.backup,
  );
  expect(controls.release).toHaveBeenCalledOnce();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('导出等待期间取消后，迟到原文回调不能读取数据库Blob或返回原文', async () => {
  await db.open();
  const payload = await fixturePayload(1, false);
  await seed(db, await prepareBooks(payload), payload);
  const snapshot = await exportSnapshot('full');
  vi.stubGlobal('Worker', WorkerStub);
  let provide!: (bookId: string) => Promise<Blob>;
  controls.invoke.mockImplementation(
    (_backup: BackupFile, reader: typeof provide) => {
      provide = reader;
      return new Promise(() => {});
    },
  );
  const controller = new AbortController();
  const job = generateFullBackup(snapshot, () => {}, controller.signal);
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(provide).toBeTypeOf('function'));
  controller.abort();
  await rejected;
  const read = vi.spyOn(db.blobs, 'get');
  await expect(provide(snapshot.sources[0]!.bookId)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('第二本RPC等待期间取消会删除前一本暂存，晚到结果不复活暂存或写主库', async () => {
  await db.open();
  const payload = await fixturePayload(2, false);
  const prepared = await prepareBooks(payload);
  vi.stubGlobal('Worker', WorkerStub);
  let finish: ((value: (typeof prepared)[number]) => void) | undefined;
  controls.invoke.mockResolvedValueOnce(prepared[0]).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const result = restoreFromBackup(
    { backup: payload.backup, archive: new File([], 'backup.zip') },
    'overwrite',
    () => {},
    controller.signal,
  );
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(controls.invoke).toHaveBeenCalledTimes(2));
  expect(await db.blobs.count()).toBe(1);
  expect(await db.books.count()).toBe(0);
  controller.abort();
  await rejected;
  finish?.(prepared[1]!);
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (const table of db.tables) expect(await table.count()).toBe(0);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});
it('进入前已取消不启动线程；等待期间取消立即拒绝并释放代理、线程和计时器，晚到结果无效', async () => {
  const payload = await fixturePayload();
  vi.stubGlobal('Worker', WorkerStub);
  vi.useFakeTimers();
  const before = new AbortController();
  before.abort();
  await expect(
    inspectBackup(new File([], 'test.zip'), () => {}, before.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(workers).toHaveLength(0);
  let finish: ((value: BackupFile) => void) | undefined;
  controls.invoke.mockImplementation(
    () =>
      new Promise<BackupFile>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController(),
    job = inspectBackup(new File([], 'test.zip'), () => {}, controller.signal);
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve();
  controller.abort();
  await rejected;
  expect(workers[0]?.terminate).toHaveBeenCalledOnce();
  expect(controls.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  finish?.(payload.backup);
  await Promise.resolve();
  expect(controls.release).toHaveBeenCalledOnce();
});

it('预览保留调用方选择的File，仅将Worker返回的元数据放入预览，JSON不携带原文', async () => {
  const payload = await fixturePayload(2, false);
  vi.stubGlobal('Worker', WorkerStub);
  controls.invoke.mockResolvedValueOnce(payload.backup);
  const file = new File([], 'full.zip');
  const preview = await inspectBackup(file, () => {});
  expect(preview.archive).toBe(file);
  expect(preview.backup).toEqual(payload.backup);
  expect(preview).not.toHaveProperty('originals');
  controls.invoke.mockResolvedValueOnce({
    ...payload.backup,
    kind: 'light',
    files: [],
  });
  expect(
    (await inspectBackup(new File([], 'light.json'), () => {})).archive,
  ).toBeUndefined();
  expect(
    workers.every((worker) => worker.terminate.mock.calls.length === 1),
  ).toBe(true);
});

it('重新读取的未引用条目CRC失败发生在全部暂存后，仍清理暂存且不修改原主库', async () => {
  await db.open();
  const local = await fixturePayload(1, false);
  await seed(db, await prepareBooks(local), local);
  const before = await createSnapshot('full');
  const incoming = await fixturePayload(3, false);
  const zip = await JSZip.loadAsync(
    await (await buildArchive(incoming)).arrayBuffer(),
  );
  zip.file('unused.txt', '需要重新核对的未引用原文');
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  const good = new File([bytes], 'good.zip');
  const backup = await readBackup(good);
  const records = await scanZip(bytes, {
    input: bytes.byteLength,
    entries: 100,
    entry: 50 * 1024 * 1024,
    total: 100 * 1024 * 1024,
  });
  const unused = records.find((record) => record.name === 'unused.txt')!;
  const changed = new Uint8Array(bytes);
  changed[unused.dataStart] = changed[unused.dataStart]! ^ 1;
  const api = createArchiveRestoreApi();
  vi.stubGlobal('Worker', WorkerStub);
  controls.open.mockImplementation(api.openRestore);
  controls.invoke.mockImplementation(api.prepareRestoreBook);
  controls.finish.mockImplementation(async () => {
    expect(await db.books.count()).toBe(1);
    expect(await db.blobs.where('id').startsWith(RESTORE_PREFIX).count()).toBe(
      3,
    );
    return api.finishRestore();
  });
  await expect(
    restoreFromBackup(
      { backup, archive: new File([changed], 'changed.zip') },
      'overwrite',
      () => {},
    ),
  ).rejects.toThrow('CRC');
  expect(controls.invoke).toHaveBeenCalledTimes(3);
  expect(await db.blobs.where('id').startsWith(RESTORE_PREFIX).count()).toBe(0);
  const after = await createSnapshot('full');
  expect({ ...after.backup, exportedAt: 0 }).toEqual({
    ...before.backup,
    exportedAt: 0,
  });
  expect(await after.originals[0]!.data.text()).toBe(
    await before.originals[0]!.data.text(),
  );
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('最后的备份校验RPC等待期间取消会清理已暂存书籍，晚到结束不能提交主库', async () => {
  await db.open();
  const payload = await fixturePayload(1, false);
  controls.invoke.mockResolvedValue((await prepareBooks(payload))[0]);
  vi.stubGlobal('Worker', WorkerStub);
  let finish!: () => void;
  controls.finish.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const job = restoreFromBackup(
    { backup: payload.backup, archive: new File([], 'full.zip') },
    'overwrite',
    () => {},
    controller.signal,
  );
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(controls.finish).toHaveBeenCalledOnce());
  expect(await db.blobs.where('id').startsWith(RESTORE_PREFIX).count()).toBe(1);
  controller.abort();
  await rejected;
  finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (const table of db.tables) expect(await table.count()).toBe(0);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(controls.release).toHaveBeenCalledOnce();
});
