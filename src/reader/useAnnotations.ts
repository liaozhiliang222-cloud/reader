import { t } from '@/i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  addHighlight,
  listHighlights,
  removeHighlight,
  updateHighlight,
} from '@/db/highlights';
import { copyText } from '@/app/files';
import { sameLocator } from '@/db/bookmarks';
import type { ReaderEngine } from './ReaderEngine';
import type { SelectionRect } from './selection';
import type { TextSpan } from './annotation';
import type { Book, Highlight, Locator } from '@/types';

export type SelectedText = TextSpan & { text: string; rect: SelectionRect };
export type AnnotationTarget =
  | { selection: SelectedText; rect: SelectionRect }
  | { highlight: Highlight; rect: SelectionRect };
export type NoteTarget = { selection: SelectedText } | { highlight: Highlight };

export function useAnnotations(
  book: Book,
  engineRef: { current: ReaderEngine | undefined },
  onError: (message: string) => void,
  closeMenus: () => void,
) {
  const [items, setItems] = useState<Highlight[]>([]);
  const [target, setTarget] = useState<AnnotationTarget>();
  const [editor, setEditor] = useState<NoteTarget>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false),
    live = useRef(true);
  const targetRef = useRef(target),
    editorRef = useRef(editor);
  targetRef.current = target;
  editorRef.current = editor;
  const callbacks = useRef({ onError, closeMenus });
  callbacks.current = { onError, closeMenus };
  const blockedRef = useRef(false);
  blockedRef.current = !!(target || editor);
  const location = useRef<Locator | undefined>(undefined);
  const engine = engineRef.current;
  const close = () => {
    setTarget(undefined);
    setEditor(undefined);
    window.getSelection()?.removeAllRanges();
  };
  useEffect(() => {
    live.current = true;
    void listHighlights(book.id)
      .then((value) => {
        if (live.current) setItems(value);
      })
      .catch(() => {
        if (live.current) callbacks.current.onError(t('无法读取划线与笔记。'));
      });
    let frame = 0;
    const changed = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editorRef.current) return;
        const selected = engineRef.current?.selectedText();
        if (selected) {
          callbacks.current.closeMenus();
          setTarget({ selection: selected, rect: selected.rect });
        } else if (
          targetRef.current &&
          'selection' in targetRef.current &&
          !document.activeElement?.closest('.annotation-menu')
        )
          setTarget(undefined);
      });
    };
    document.addEventListener('selectionchange', changed);
    return () => {
      live.current = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', changed);
    };
  }, [book.id, engineRef]);
  useEffect(() => {
    engine?.setHighlights(items);
  }, [engine, items]);
  const perform = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
      const latest = await listHighlights(book.id);
      if (live.current) {
        setItems(latest);
        close();
      }
      return true;
    } catch (cause) {
      if (live.current)
        callbacks.current.onError(
          cause instanceof Error ? cause.message : t('标注未能保存，请重试。'),
        );
      return false;
    } finally {
      busyRef.current = false;
      if (live.current) setBusy(false);
    }
  };
  return {
    items,
    target,
    editor,
    busy,
    blockedRef,
    close,
    onLocation(value: Locator) {
      if (location.current && !sameLocator(location.current, value)) close();
      location.current = value;
    },
    openExisting(value: { highlight: Highlight; rect: SelectionRect }) {
      window.getSelection()?.removeAllRanges();
      callbacks.current.closeMenus();
      setTarget(value);
    },
    openNote(item?: Highlight) {
      const current = targetRef.current;
      if (item) setEditor({ highlight: item });
      else if (current) setEditor(current);
    },
    setColor(color: Highlight['color']) {
      const current = targetRef.current;
      if (current)
        void perform(() =>
          'highlight' in current
            ? updateHighlight(book.id, current.highlight.id, { color })
            : addHighlight(
                book.id,
                current.selection,
                color,
                undefined,
                book.contentRevision ?? 0,
              ),
        );
    },
    saveNote(note: string) {
      const current = editorRef.current;
      if (current)
        void perform(() =>
          'highlight' in current
            ? updateHighlight(book.id, current.highlight.id, { note })
            : addHighlight(
                book.id,
                current.selection,
                'red',
                note,
                book.contentRevision ?? 0,
              ),
        );
    },
    remove() {
      const current = targetRef.current;
      if (current && 'highlight' in current)
        void perform(() => removeHighlight(book.id, current.highlight.id));
    },
    async copy() {
      const current = targetRef.current;
      if (!current) return;
      try {
        await copyText(
          'highlight' in current
            ? current.highlight.text
            : current.selection.text,
        );
        if (live.current) close();
      } catch (cause) {
        if (live.current)
          callbacks.current.onError(
            cause instanceof Error
              ? cause.message
              : t('复制失败，请使用系统选区菜单。'),
          );
      }
    },
  };
}
