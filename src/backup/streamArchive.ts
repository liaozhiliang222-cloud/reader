import JSZip from 'jszip';
import { BACKUP_ENTRY_LIMIT, BACKUP_METADATA_LIMIT } from './limits';

export type ArchiveEntry = { path: string } & (
  { data: Blob } | { size: number; read: () => Promise<ArrayBuffer> }
);

/** JSZip's streamed headers announce a file before its deferred body is read.
 * Keep at most one expanded original in JSZip, and turn output into bounded
 * Blob batches instead of accumulating a single archive-sized typed array.
 * The final Blob and browser backing storage are still not a constant-RAM claim.
 */
export async function streamArchive(
  entries: ArchiveEntry[],
  onProgress: (percent: number) => void,
): Promise<Blob> {
  // JSZip emits classic ZIP fields, not ZIP64 output. Reject before reading
  // originals rather than silently wrapping directory offsets or entry counts.
  if (entries.length > BACKUP_ENTRY_LIMIT)
    throw new Error('备份条目超过 20000 项，未生成文件。');
  const paths = new Set<string>();
  let size = 22,
    directorySize = 0;
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error('备份包含重复路径。');
    paths.add(entry.path);
    const nameSize = new TextEncoder().encode(entry.path).byteLength;
    const extraSize = nameSize === entry.path.length ? 0 : nameSize + 9;
    if (
      !nameSize ||
      entry.path.endsWith('/') ||
      nameSize > 0xffff ||
      extraSize > 0xffff
    )
      throw new Error('备份文件名超出 ZIP 格式范围。');
    const bytes = 'data' in entry ? entry.data.size : entry.size;
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('备份原文件大小无效。');
    size += bytes + 92 + 2 * nameSize + 2 * extraSize;
    directorySize += 46 + nameSize + extraSize;
  }
  if (directorySize > BACKUP_METADATA_LIMIT)
    throw new Error('备份 ZIP 目录超过 32 MiB，未生成文件。');
  if (
    entries.length >= 0xffff ||
    !Number.isSafeInteger(size) ||
    size >= 0xffffffff
  )
    throw new Error(
      '完整备份超过当前 ZIP 格式上限，未生成文件，本机数据未修改。',
    );
  const zip = new JSZip();
  const pending = new Map<string, () => void>();
  let stopped = false;
  for (const entry of entries) {
    const body = new Promise<ArrayBuffer>((resolve, reject) => {
      pending.set(entry.path, () => {
        pending.delete(entry.path);
        void (async () => {
          try {
            const bytes =
              'data' in entry
                ? await entry.data.arrayBuffer()
                : await entry.read();
            if (stopped) return;
            const expected = 'data' in entry ? entry.data.size : entry.size;
            if (bytes.byteLength !== expected)
              throw new Error('备份原文大小与快照不一致。');
            resolve(bytes);
          } catch (cause) {
            reject(cause);
          }
        })();
      });
    });
    zip.file(entry.path, body, { binary: true, createFolders: false });
  }
  const stream = zip.generateInternalStream({
    type: 'uint8array',
    streamFiles: true,
    compression: 'STORE',
  });
  return new Promise((resolve, reject) => {
    const output: Blob[] = [];
    let chunks: Uint8Array<ArrayBuffer>[] = [],
      buffered = 0;
    let current: string | null = null;
    const flush = () => {
      if (chunks.length) output.push(new Blob(chunks));
      chunks = [];
      buffered = 0;
    };
    const cleanup = () => {
      pending.clear();
      for (const path of Object.keys(zip.files)) zip.remove(path);
      chunks = [];
      output.length = 0;
    };
    const fail = (cause: unknown) => {
      if (stopped) return;
      stopped = true;
      stream.pause();
      cleanup();
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    stream.on('data', (data, metadata) => {
      if (stopped) return;
      try {
        if (current !== metadata.currentFile) {
          if (current) zip.remove(current);
          current = metadata.currentFile;
          if (current) pending.get(current)?.();
        }
        chunks.push(Uint8Array.from(data));
        buffered += data.byteLength;
        if (buffered >= 1024 * 1024) flush();
        onProgress(metadata.percent);
      } catch (cause) {
        fail(cause);
      }
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (stopped) return;
      try {
        flush();
        const result = new Blob(output, { type: 'application/zip' });
        stopped = true;
        cleanup();
        resolve(result);
      } catch (cause) {
        fail(cause);
      }
    });
    stream.resume();
  });
}
