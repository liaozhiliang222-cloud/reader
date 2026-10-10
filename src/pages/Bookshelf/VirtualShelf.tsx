import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { visibleRange } from '@/components/virtualRange';
import { beginMeasure } from '@/app/performance';
import { BookRow } from './BookRow';
import type { ShelfEntry } from './model';
import type { Book } from '@/types';

export const SHELF_ROW_HEIGHT = 140;
export function VirtualShelf({
  entries,
  onRead,
  onActions,
}: {
  entries: ShelfEntry[];
  onRead: (book: Book) => void;
  onActions: (book: Book) => void;
}) {
  const root = useRef<HTMLUListElement>(null);
  const focusFrame = useRef(0);
  const [range, setRange] = useState({
    start: 0,
    end: Math.min(entries.length, 12),
  });
  const [focused, setFocused] = useState<number>();
  useLayoutEffect(() => {
    const end = beginMeasure('书架视口呈现');
    let frame = 0;
    const measure = () => {
      const top = root.current!.getBoundingClientRect().top;
      const next = visibleRange(
        entries.length,
        Math.max(0, -top),
        Math.max(0, window.innerHeight - Math.max(0, top)),
        SHELF_ROW_HEIGHT,
        3,
      );
      setRange((current) =>
        current.start === next.start && current.end === next.end
          ? current
          : next,
      );
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(refresh);
    observer.observe(root.current!.parentElement!);
    window.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh);
    const firstFrame = requestAnimationFrame(() => end());
    return () => {
      end(false);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame.current);
      observer.disconnect();
      window.removeEventListener('scroll', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, [entries]);
  const focusAt = (index: number, more: boolean) => {
    const selector = `[data-shelf-index="${index}"] .${more ? 'shelf-more' : 'shelf-entry'}`;
    const existing = root.current?.querySelector<HTMLButtonElement>(selector);
    if (existing) {
      existing.focus();
      return;
    }
    setRange(
      visibleRange(
        entries.length,
        index * SHELF_ROW_HEIGHT,
        window.innerHeight,
        SHELF_ROW_HEIGHT,
        3,
      ),
    );
    const top = root.current!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + index * SHELF_ROW_HEIGHT, behavior: 'auto' });
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(selector)
        ?.focus({ preventScroll: true }),
    );
  };
  const indices = Array.from(
    {
      length: Math.max(
        0,
        Math.min(entries.length, range.end) -
          Math.min(entries.length, range.start),
      ),
    },
    (_, offset) => range.start + offset,
  );
  if (
    focused !== undefined &&
    focused < entries.length &&
    !indices.includes(focused)
  )
    indices.push(focused);
  indices.sort((a, b) => a - b);
  return (
    <ul
      ref={root}
      class="virtual-shelf"
      aria-label="本地书架"
      style={{ height: `${entries.length * SHELF_ROW_HEIGHT}px` }}
      onFocusCapture={(event) => {
        const row = (event.target as Element).closest<HTMLElement>(
          '[data-shelf-index]',
        );
        if (row) setFocused(Number(row.dataset.shelfIndex));
      }}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setFocused(undefined);
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const row = target.closest<HTMLElement>('[data-shelf-index]');
        if (
          !row ||
          !target.closest('button') ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const index = Number(row.dataset.shelfIndex),
          more = target.classList.contains('shelf-more');
        let next = index,
          nextMore = more;
        if (event.key === 'ArrowDown') next++;
        else if (event.key === 'ArrowUp') next--;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = entries.length - 1;
        else if (event.key === 'Tab') {
          if (event.shiftKey) {
            if (!more) {
              next--;
              nextMore = true;
            } else nextMore = false;
          } else {
            if (more) {
              next++;
              nextMore = false;
            } else nextMore = true;
          }
          if (next < 0 || next >= entries.length) return;
        } else return;
        event.preventDefault();
        focusAt(Math.max(0, Math.min(entries.length - 1, next)), nextMore);
      }}
    >
      {indices.map((index) => (
        <BookRow
          key={entries[index]!.book.id}
          entry={entries[index]!}
          onRead={onRead}
          onActions={onActions}
          virtual={{ index, count: entries.length, height: SHELF_ROW_HEIGHT }}
        />
      ))}
    </ul>
  );
}
