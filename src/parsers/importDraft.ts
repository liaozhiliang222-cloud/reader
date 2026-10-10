import { releaseProxy, wrap } from 'comlink';
import type { parseDraft } from '@/parsers/paste';
import { runWorkerTask } from '@/workers/runTask';
import { saveDraft, getBook } from '@/db/repository';
import type { Book } from '@/types';
import type { DraftFormat } from './markdown';
import { bookIdForHash, sourceHash } from './identity';

export async function importDraft(
  text: string,
  title: string,
  editingId?: string,
  format: DraftFormat = 'plain',
) {
  let previous: Book | undefined;
  if (format === 'markdown') {
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > 50 * 1024 * 1024)
      throw new Error('文稿超过 50 MB，请拆分后导入。');
    previous = await getBook(
      bookIdForHash(
        { type: 'paste', draftFormat: 'markdown' },
        await sourceHash(bytes),
      ),
    );
  }
  const worker = new Worker(
    new URL('../workers/parse.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const api = wrap<{ parseDraft: typeof parseDraft }>(worker);
  try {
    let result = await runWorkerTask<Awaited<ReturnType<typeof parseDraft>>>(
      worker,
      () => api.parseDraft(text, format, previous?.markdownVersion ?? 2),
    );
    const existing = await getBook(result.id);
    if (
      format === 'markdown' &&
      existing?.markdownVersion &&
      existing.markdownVersion !== result.markdownVersion
    )
      result = await runWorkerTask<Awaited<ReturnType<typeof parseDraft>>>(
        worker,
        () => api.parseDraft(text, format, existing.markdownVersion),
      );
    const now = Date.now();
    const book: Book = {
      id: result.id,
      title: title.trim() || result.title,
      type: 'paste',
      draftFormat: format === 'markdown' ? 'markdown' : undefined,
      markdownVersion: result.markdownVersion,
      toc: result.toc,
      size: result.size,
      charCount: result.charCount,
      chapterCount: result.chapters.length,
      importedAt: now,
      lastReadAt: now,
    };
    return await saveDraft(book, result.chapters, text, editingId);
  } finally {
    api[releaseProxy]();
    worker.terminate();
  }
}
