import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase } from '@/db/schema';
import { fixturePayload, seed } from './fixtures';
import { prepareBooks } from './archive';
import { restoreBackup } from './restore';
import {
  createRestoreStage,
  RESTORE_PREFIX,
  withRestoreStage,
} from './staging';
import { snapshotPayload as createSnapshot } from './fixtures';

const database = createDatabase('restore-stage-test');
beforeEach(async () => {
  await database.open();
});
afterEach(async () => {
  await database.delete();
});
const stagedCount = () =>
  database.blobs.where('id').startsWith(RESTORE_PREFIX).count();

it('清理只移除失去锁的孤儿暂存，活跃恢复会话互不删除', async () => {
  expect(navigator.locks).toBeDefined();
  const item = (await prepareBooks(await fixturePayload(1, false)))[0]!;
  const orphan = createRestoreStage(database);
  await orphan.put(item);
  await withRestoreStage(async (first) => {
    await expect(orphan.get(item.book.id)).rejects.toThrow('暂存已丢失');
    await first.put(item);
    await withRestoreStage(async (second) => {
      expect((await first.get(item.book.id)).book.id).toBe(item.book.id);
      await second.put(item);
      expect(await stagedCount()).toBe(2);
    }, database);
    expect(await stagedCount()).toBe(1);
  }, database);
  expect(await stagedCount()).toBe(0);
});

it('取消发生在读取暂存字节期间时，晚到字节不能重新创建已清理的记录', async () => {
  const item = (await prepareBooks(await fixturePayload(1, false)))[0]!;
  let finish!: (bytes: ArrayBuffer) => void;
  const blob = item.blobs[0]!.data;
  const bytes = await blob.arrayBuffer();
  const spy = vi.spyOn(blob, 'arrayBuffer').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stage = createRestoreStage(database);
  const write = stage.put(item);
  const rejected = expect(write).rejects.toMatchObject({ name: 'AbortError' });
  await stage.dispose();
  finish(bytes);
  await rejected;
  spy.mockRestore();
  expect(await stagedCount()).toBe(0);
});

it('逐书暂存不进入书架或备份，原子恢复后清理自己的暂存，其他操作保留', async () => {
  const payload = await fixturePayload(12);
  const prepared = await prepareBooks(payload);
  const other = createRestoreStage(database);
  await other.put(prepared[0]!);
  await withRestoreStage(
    async (stage) => {
      for (const item of prepared) await stage.put(item);
      expect(await database.books.count()).toBe(0);
      expect(await stagedCount()).toBe(14);
      expect((await createSnapshot('full', database)).originals).toEqual([]);
      const order: string[] = [];
      const source = {
        ids: stage.ids,
        get: async (id: string) => {
          // The previous book has already been applied in THIS transaction before
          // loading the next one; nothing has committed outside it yet.
          expect(await database.books.count()).toBe(order.length);
          order.push(id);
          return stage.get(id);
        },
      };
      await restoreBackup(payload, source, 'overwrite', database);
      expect(order).toEqual(payload.backup.books.map((book) => book.id));
    },
    database,
    null,
  );
  expect(await stagedCount()).toBe(1);
  expect(await other.get(prepared[0]!.book.id)).toMatchObject(prepared[0]!);
  const snapshot = await createSnapshot('full', database);
  expect(snapshot.originals).toHaveLength(13);
  for (const original of snapshot.originals)
    expect(await original.data.text()).toBe(
      await payload.originals
        .find((row) => row.bookId === original.bookId)!
        .data.text(),
    );
  await other.dispose();
  expect(await stagedCount()).toBe(0);
});

it('最后一本位置错误时回滚此前全部写入，清理暂存且保留原书和设置', async () => {
  const payload = await fixturePayload(3, false),
    prepared = await prepareBooks(payload);
  await seed(database, prepared, payload);
  const before = await createSnapshot('full', database);
  const last = payload.backup.books.at(-1)!;
  const invalid = {
    ...payload,
    backup: {
      ...payload.backup,
      progress: [
        {
          ...payload.backup.progress[0]!,
          bookId: last.id,
          locator: { chapterIndex: 0, paragraphIndex: 0, charOffset: 999 },
        },
      ],
    },
  };
  await expect(
    withRestoreStage(
      async (stage) => {
        for (const item of prepared) await stage.put(item);
        await restoreBackup(invalid, stage, 'overwrite', database);
      },
      database,
      null,
    ),
  ).rejects.toThrow('位置');
  const after = await createSnapshot('full', database);
  expect({ ...after.backup, exportedAt: 0 }).toEqual({
    ...before.backup,
    exportedAt: 0,
  });
  expect(await stagedCount()).toBe(0);
});

it('第二本读取时取消会中止事务，暂存清除且主库不留第一本', async () => {
  const payload = await fixturePayload(3, false),
    prepared = await prepareBooks(payload);
  const controller = new AbortController();
  await expect(
    withRestoreStage(
      async (stage) => {
        for (const item of prepared) await stage.put(item);
        let reads = 0;
        await restoreBackup(
          payload,
          {
            ids: stage.ids,
            get: async (id) => {
              const item = await stage.get(id);
              if (++reads === 2) controller.abort();
              return item;
            },
          },
          'overwrite',
          database,
          controller.signal,
        );
      },
      database,
      null,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  for (const table of database.tables) expect(await table.count()).toBe(0);
});

it('暂存空间不足清理已保存的前一本，主库未开始修改', async () => {
  const prepared = await prepareBooks(await fixturePayload(3, false));
  let writes = 0;
  const fail = (_key: unknown, record: { id: string }) => {
    if (record.id.startsWith(RESTORE_PREFIX) && ++writes === 2)
      throw new Error('quota');
  };
  database.blobs.hook('creating', fail);
  try {
    await expect(
      withRestoreStage(
        async (stage) => {
          for (const item of prepared) await stage.put(item);
        },
        database,
        null,
      ),
    ).rejects.toThrow('quota');
  } finally {
    database.blobs.hook('creating').unsubscribe(fail);
  }
  for (const table of database.tables) expect(await table.count()).toBe(0);
});

it('轻量覆盖不保留缺章书的残余正文', async () => {
  const payload = await fixturePayload(1, false),
    prepared = await prepareBooks(payload);
  await seed(database, prepared, payload);
  await database.chapters.delete([prepared[0]!.book.id, 1]);
  await restoreBackup(
    { backup: { ...payload.backup, kind: 'light', files: [] } },
    [],
    'overwrite',
    database,
  );
  expect((await database.books.toArray())[0]!.missingFile).toBe(true);
  expect(await database.chapters.count()).toBe(0);
  expect(await database.blobs.count()).toBe(0);
});
