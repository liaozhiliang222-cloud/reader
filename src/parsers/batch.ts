import type { Book } from '@/types';
export interface ImportResult {
  book: Book;
  duplicate: boolean;
}
export interface ImportItem {
  name: string;
  status: 'waiting' | 'parsing' | 'success' | 'duplicate' | 'error';
  book?: Book;
  error?: string;
}

/** 串行限流，单个解析失败不影响其余文件。 */
export async function importBatch(
  files: File[],
  parse: (file: File) => Promise<ImportResult>,
  onChange: (items: ImportItem[]) => void,
): Promise<ImportItem[]> {
  const items: ImportItem[] = files.map((file) => ({
    name: file.name,
    status: 'waiting',
  }));
  const notify = () => onChange(items.map((item) => ({ ...item })));
  notify();
  for (const [index, file] of files.entries()) {
    const item = items[index]!;
    item.status = 'parsing';
    notify();
    try {
      const result = await parse(file);
      item.book = result.book;
      item.status = result.duplicate ? 'duplicate' : 'success';
    } catch (cause) {
      item.status = 'error';
      item.error =
        cause instanceof Error ? cause.message : '导入失败，请重试。';
    }
    notify();
  }
  return items;
}
