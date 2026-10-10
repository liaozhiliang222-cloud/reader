import { useEffect, useState } from 'preact/hooks';
import type { CSSProperties } from 'preact/compat';
import { getBlob } from '@/db/repository';
import type { Book } from '@/types';

const COVER_HUES = [16, 38, 74, 130, 175, 208, 258, 318];

function coverHue(title: string) {
  let hash = 0;
  for (const char of title)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return COVER_HUES[hash % COVER_HUES.length];
}

export function BookCover({ book }: { book: Book }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setSrc(undefined);
    if (book.coverBlobId)
      void getBlob(book.coverBlobId)
        .then((blob) => {
          if (
            cancelled ||
            !blob ||
            !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(blob.data.type)
          )
            return;
          url = URL.createObjectURL(blob.data);
          setSrc(url);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [book.coverBlobId]);
  return src ? (
    <img class="book-cover book-cover-image" src={src} alt="" />
  ) : (
    <span
      class="book-cover"
      style={{ '--cover-hue': coverHue(book.title) } as CSSProperties}
      aria-hidden="true"
    >
      {book.title.slice(0, 10)}
    </span>
  );
}
