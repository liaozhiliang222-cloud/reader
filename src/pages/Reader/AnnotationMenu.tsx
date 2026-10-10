import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { selectionMenuPosition } from '@/reader/selection';
import type { AnnotationTarget } from '@/reader/useAnnotations';
import type { Highlight } from '@/types';

export function AnnotationMenu({
  target,
  busy,
  onColor,
  onNote,
  onCopy,
  onRemove,
  onClose,
}: {
  target: AnnotationTarget;
  busy: boolean;
  onColor: (color: Highlight['color']) => void;
  onNote: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const existing = 'highlight' in target ? target.highlight : undefined;
  useLayoutEffect(() => {
    const menu = ref.current!;
    const place = () => {
      const view = window.visualViewport;
      const left = view?.offsetLeft ?? 0,
        top = view?.offsetTop ?? 0;
      setPosition(
        selectionMenuPosition(
          target.rect,
          menu.offsetWidth,
          menu.offsetHeight,
          {
            left,
            top,
            right: left + (view?.width ?? window.innerWidth),
            bottom: top + (view?.height ?? window.innerHeight),
          },
        ),
      );
    };
    const resize = new ResizeObserver(place);
    resize.observe(menu);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    place();
    return () => {
      resize.disconnect();
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [target]);
  return (
    <div
      ref={ref}
      class="annotation-menu"
      role="toolbar"
      aria-label={existing ? '编辑划线' : '文字选区操作'}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onPointerDown={(event) => event.preventDefault()}
    >
      {(['red', 'blue', 'yellow'] as const).map((color, index) => (
        <button
          class="highlight-color"
          data-color={color}
          aria-label={`${existing ? '改为' : '添加'}${['朱砂红', '墨蓝', '琥珀黄'][index]}划线`}
          aria-pressed={existing?.color === color}
          disabled={busy}
          onClick={() => onColor(color)}
        >
          <span aria-hidden="true" />
        </button>
      ))}
      <button disabled={busy} onClick={onNote}>
        {existing?.note ? '编辑笔记' : '笔记'}
      </button>
      <button disabled={busy} onClick={onCopy}>
        复制
      </button>
      {existing && (
        <button
          disabled={busy}
          aria-label={`删除划线${existing.note ? '与笔记' : ''}`}
          onClick={onRemove}
        >
          删除
        </button>
      )}
      <button disabled={busy} onClick={onClose}>
        关闭
      </button>
    </div>
  );
}
