import { db } from '@/db';
import type { PreparedBook } from './types';

export const RESTORE_PREFIX = 'restore-stage:';
export interface PreparedSource {
  ids: string[];
  get(id: string): Promise<PreparedBook | undefined>;
}
interface StagedBook extends Omit<PreparedBook, 'blobs'> {
  blobs: { id: string; bytes: ArrayBuffer; type: string }[];
}
export function createRestoreStage(
  database = db,
  session = crypto.randomUUID(),
) {
  const prefix = `${RESTORE_PREFIX}${session}:`;
  const ids: string[] = [];
  let disposed = false;
  const active = () => {
    if (disposed) throw new DOMException('恢复已取消。', 'AbortError');
  };
  return {
    ids,
    async put(value: PreparedBook) {
      active();
      if (ids.includes(value.book.id))
        throw new Error('恢复内容包含重复书籍。');
      // The WebKit restore regression lost Blob access after staging cleanup;
      // the minimal native probe did not reproduce the full failure. Store owned
      // bytes and rebuild independent Blobs without async reads in the transaction.
      const blobs: StagedBook['blobs'] = [];
      for (const blob of value.blobs)
        blobs.push({
          id: blob.id,
          bytes: await blob.data.arrayBuffer(),
          type: blob.data.type,
        });
      active();
      const record = {
        id: prefix + value.book.id,
        data: new Blob([]),
        prepared: { book: value.book, chapters: value.chapters, blobs },
      };
      await database.blobs.put(record);
      ids.push(value.book.id);
    },
    async get(id: string) {
      active();
      const record = await database.blobs.get(prefix + id);
      if (!record || !('prepared' in record))
        throw new Error('恢复暂存已丢失，请重新选择备份。');
      // Only this operation writes this random namespace; values are structured clones.
      const value = record.prepared as StagedBook;
      if (value.book.id !== id) throw new Error('恢复暂存与书籍不一致。');
      return {
        ...value,
        blobs: value.blobs.map((blob) => ({
          id: blob.id,
          data: new Blob([blob.bytes], { type: blob.type }),
        })),
      };
    },
    async dispose() {
      disposed = true;
      await database.blobs.where('id').startsWith(prefix).delete();
    },
  };
}

// A browser-owned lock survives async parsing but is released on tab/process death.
// Reap only namespaces whose owners no longer hold their lock. Without Web Locks,
// own-operation finally cleanup still works; clear-data can remove crash leftovers.
export async function withRestoreStage<T>(
  action: (stage: ReturnType<typeof createRestoreStage>) => Promise<T>,
  database = db,
  locks: LockManager | null | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.locks,
) {
  const session = crypto.randomUUID();
  const lockName = (id: string) => `${database.name}/${RESTORE_PREFIX}${id}`;
  const run = async () => {
    const stage = createRestoreStage(database, session);
    try {
      if (locks) {
        const keys = await database.blobs
          .where('id')
          .startsWith(RESTORE_PREFIX)
          .primaryKeys();
        const sessions = new Set(
          keys.map((key) => key.slice(RESTORE_PREFIX.length).split(':')[0]!),
        );
        for (const old of sessions) {
          if (old === session) continue;
          await locks.request(
            lockName(old),
            { ifAvailable: true },
            async (lock) => {
              if (lock)
                await database.blobs
                  .where('id')
                  .startsWith(`${RESTORE_PREFIX}${old}:`)
                  .delete();
            },
          );
        }
      }
      return await action(stage);
    } finally {
      await stage.dispose();
    }
  };
  return locks ? locks.request(lockName(session), run) : run();
}
