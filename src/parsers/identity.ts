import type { Book } from '@/types';

export function bookIdForHash(
  book: Pick<Book, 'type' | 'draftFormat'>,
  hash: string,
) {
  const prefix =
    book.type === 'md'
      ? 'md:'
      : book.type === 'paste'
        ? book.draftFormat === 'markdown'
          ? 'paste-md:'
          : 'paste:'
        : book.type === 'pdf'
          ? 'pdf:'
          : '';
  return prefix + hash;
}

export async function sourceHash(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
