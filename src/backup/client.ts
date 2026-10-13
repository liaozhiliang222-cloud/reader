import { proxy, releaseProxy, wrap } from 'comlink';
import { runWorkerTask } from '@/workers/runTask';
import type {
  buildSnapshotArchive,
  readBackup,
  createArchiveRestoreApi,
} from './archive';
import { withRestoreStage } from './staging';
import { restoreBackup } from './restore';
import type { BackupSnapshot, BackupPreview, OnBackupProgress } from './types';
import { readSnapshotOriginal } from './snapshot';
type BackupApi = {
  buildSnapshotArchive: typeof buildSnapshotArchive;
  readBackup: typeof readBackup;
} & ReturnType<typeof createArchiveRestoreApi>;
async function run<T>(
  task: (api: ReturnType<typeof wrap<BackupApi>>) => Promise<T>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const worker = new Worker(
    new URL('../workers/parse.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const api = wrap<BackupApi>(worker);
  let abort: (() => void) | undefined;
  const cancelled = new Promise<T>((_, reject) => {
    abort = () => reject(new DOMException('备份操作已取消。', 'AbortError'));
  });
  signal?.addEventListener('abort', abort!, { once: true });
  try {
    return await runWorkerTask(
      worker,
      () => Promise.race([task(api), cancelled]),
      300_000,
    );
  } finally {
    signal?.removeEventListener('abort', abort!);
    api[releaseProxy]();
    worker.terminate();
  }
}
export const generateFullBackup = (
  snapshot: BackupSnapshot,
  onProgress: OnBackupProgress,
  signal?: AbortSignal,
) => {
  const sources = new Map(
    snapshot.sources.map((source) => [source.bookId, source]),
  );
  return run(
    (api) =>
      api.buildSnapshotArchive(
        snapshot.backup,
        proxy(async (bookId: string) => {
          const source = sources.get(bookId);
          if (!source) throw new Error('备份原文件与快照不一致。');
          return readSnapshotOriginal(source, undefined, signal);
        }),
        proxy(onProgress),
      ),
    signal,
  );
};
export const inspectBackup = async (
  file: File,
  onProgress: OnBackupProgress,
  signal?: AbortSignal,
): Promise<BackupPreview> => {
  const backup = await run(
    (api) => api.readBackup(file, proxy(onProgress)),
    signal,
  );
  return { backup, archive: /\.zip$/i.test(file.name) ? file : undefined };
};
export const restoreFromBackup = async (
  preview: BackupPreview,
  mode: 'merge' | 'overwrite',
  onProgress: OnBackupProgress,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  // 恢复前先停止原生听书会话，旧会话回调不得落进新数据。
  const { stopSpeech } = await import('@/app/speech/coordinator');
  await stopSpeech();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await withRestoreStage(async (stage) => {
      try {
        await run(async (api) => {
          await api.openRestore(preview);
          const metadata = new Map(
            preview.backup.books.map((book) => [book.id, book]),
          );
          for (const [index, source] of preview.backup.files.entries()) {
            controller.signal.throwIfAborted();
            const meta = metadata.get(source.bookId);
            if (!meta) throw new Error('恢复内容与备份书架不一致。');
            const item = await api.prepareRestoreBook(source.bookId);
            controller.signal.throwIfAborted();
            await stage.put(item);
            onProgress({
              percent: ((index + 1) / preview.backup.files.length) * 100,
              message: `正在验证并解析 ${meta.title}`,
            });
          }
          await api.finishRestore();
        }, controller.signal);
        controller.signal.throwIfAborted();
        onProgress({ percent: 100, message: '正在保存恢复的数据…' });
        return await restoreBackup(
          preview,
          stage,
          mode,
          undefined,
          controller.signal,
        );
      } finally {
        // Also guards late RPC completions after worker failure or timeout.
        controller.abort();
      }
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};
