import { t } from '@/i18n';
import { wrap, transfer, releaseProxy } from 'comlink';
import { db } from '@/db';
import { runWorkerTask } from '@/workers/runTask';
import type { parseText } from '@/workers/parse.worker';
import type { Book } from '@/types';

export const TEXT_ENCODINGS = [
  ['utf-8', 'UTF-8'],
  ['gb18030', 'GB18030 / GBK'],
  ['big5', 'Big5（繁体中文）'],
  ['utf-16le', 'UTF-16 LE'],
  ['utf-16be', 'UTF-16 BE'],
] as const;
export type TextEncoding = (typeof TEXT_ENCODINGS)[number][0];
export type ReparsedText = Awaited<ReturnType<typeof parseText>>;
export const isTextEncoding = (value: string): value is TextEncoding =>
  TEXT_ENCODINGS.some(([encoding]) => encoding === value);

/** 预览只读原文件，Worker 结束或取消时释放 RPC 与线程。 */
export async function previewEncoding(
  book: Book,
  encoding: TextEncoding,
  signal?: AbortSignal,
): Promise<ReparsedText> {
  if (book.type !== 'txt' || book.missingFile)
    throw new Error(t('只有原文件完整的 TXT 可以切换编码。'));
  const original = await db.blobs.get(book.fileBlobId ?? book.id);
  if (!original) throw new Error(t('原文件已不可用，请从书架重新导入。'));
  const buffer = await original.data.arrayBuffer();
  signal?.throwIfAborted();
  const worker = new Worker(
    new URL('../workers/parse.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const api = wrap<{ parseText: typeof parseText }>(worker);
  try {
    const result = await runWorkerTask(
      worker,
      () => api.parseText(transfer(buffer, [buffer]), encoding),
      120_000,
      signal,
    );
    if (result.id !== book.id)
      throw new Error(t('原文件指纹不一致，未修改书籍。'));
    return result;
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'TypeError')
      throw new Error(t('该编码无法完整解码原文件，请选择其他编码。'), {
        cause,
      });
    throw cause;
  } finally {
    try {
      api[releaseProxy]();
    } finally {
      worker.terminate();
    }
  }
}
