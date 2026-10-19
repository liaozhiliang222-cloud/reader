import { t } from '@/i18n';
import { wrap, transfer, releaseProxy } from 'comlink';
import type { parseFile } from '@/workers/parse.worker';
import { saveBook, getBook } from '@/db/repository';
import type { Book } from '@/types';
import { runWorkerTask } from '@/workers/runTask';
import type { ImportResult } from './batch';
import { bookIdForHash, sourceHash } from './identity';

export async function importText(file: File): Promise<ImportResult> {
  if (
    !/\.(txt|epub|md|markdown)$/i.test(file.name) &&
    !/\.(md|markdown)\.zip$/i.test(file.name)
  )
    throw new Error(
      t('请选择 TXT、EPUB 或 Markdown 文件（图片附件使用 .md.zip 图文包）。'),
    );
  const type = /\.epub$/i.test(file.name)
    ? 'epub'
    : /\.(md|markdown)(\.zip)?$/i.test(file.name)
      ? 'md'
      : 'txt';
  if (file.size > 50 * 1024 * 1024)
    throw new Error(t('文件超过 50 MB，请拆分后导入。'));
  const buffer = await file.arrayBuffer();
  // Read the version before parsing: a v1 document may use syntax rejected by
  // v2. Its original bytes already provide the exact stored identity.
  const previous =
    type === 'md'
      ? await getBook(bookIdForHash({ type }, await sourceHash(buffer)))
      : undefined;
  if (previous && !previous.missingFile)
    return { book: previous, duplicate: true };
  const worker = new Worker(
    new URL('../workers/parse.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const api = wrap<{ parseFile: typeof parseFile }>(worker);
  const start = performance.now();
  try {
    let result = await runWorkerTask<Awaited<ReturnType<typeof parseFile>>>(
      worker,
      () =>
        api.parseFile(
          transfer(buffer, [buffer]),
          type,
          previous?.encoding,
          undefined,
          previous?.markdownVersion ?? 2,
        ),
    );
    const existing = await getBook(result.id);
    if (existing && !existing.missingFile)
      return { book: existing, duplicate: true };
    // 轻量备份的补导必须恢复用户选择的编码，不能退回自动识别。
    if (
      (type === 'txt' || type === 'md') &&
      existing &&
      ((existing.encoding && existing.encoding !== result.encoding) ||
        (type === 'md' && existing.markdownVersion !== result.markdownVersion))
    ) {
      const original = await file.arrayBuffer();
      result = await runWorkerTask<Awaited<ReturnType<typeof parseFile>>>(
        worker,
        () =>
          api.parseFile(
            transfer(original, [original]),
            type,
            existing.encoding,
            undefined,
            existing.markdownVersion ?? 1,
          ),
      );
    }
    if (
      type === 'epub' &&
      existing &&
      result.parserVersion !== (existing.parserVersion ?? 1)
    ) {
      const original = await file.arrayBuffer();
      result = await runWorkerTask<Awaited<ReturnType<typeof parseFile>>>(
        worker,
        () =>
          api.parseFile(
            transfer(original, [original]),
            type,
            undefined,
            existing.parserVersion ?? 1,
          ),
      );
    }
    const book: Book = {
      id: result.id,
      title:
        result.title ?? file.name.replace(/\.(txt|epub|md|markdown)$/i, ''),
      type,
      author: result.author,
      coverBlobId: result.coverBlobId,
      toc: result.toc,
      encoding: result.encoding,
      parserVersion: result.parserVersion,
      markdownVersion: result.markdownVersion,
      charCount: result.charCount,
      chapterCount: result.chapters.length,
      importedAt: Date.now(),
      lastReadAt: Date.now(),
      size: file.size,
    };
    const inserted = await saveBook(book, result.chapters, file, result.assets);
    console.info(
      `${type.toUpperCase()} 导入 ${Math.round(performance.now() - start)} ms，${file.size} 字节，${book.chapterCount} 章`,
    );
    return { book: (await getBook(book.id)) ?? book, duplicate: !inserted };
  } finally {
    api[releaseProxy]();
    worker.terminate();
  }
}
