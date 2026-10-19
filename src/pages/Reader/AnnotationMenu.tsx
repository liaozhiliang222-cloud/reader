import { t } from '@/i18n';
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
      aria-label={existing ? t('编辑划线') : t('文字选区操作')}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onPointerDown={(event) => event.preventDefault()}
    >
      {(['red', 'blue', 'yellow'] as const).map((color, index) => (
        <button
          class="highlight-color"
          data-color={color}
          aria-label={t(
            '{0}{1}划线',
            existing ? t('改为') : t('添加'),
            [t('朱砂红'), t('墨蓝'), t('琥珀黄')][index],
          )}
          aria-pressed={existing?.color === color}
          disabled={busy}
          onClick={() => onColor(color)}
        >
          <span aria-hidden="true" />
        </button>
      ))}
      <button disabled={busy} onClick={onNote}>
        {existing?.note ? t('编辑笔记') : t('笔记')}
      </button>
      <button disabled={busy} onClick={onCopy}>
        {t('复制')}
      </button>
      {existing && (
        <button
          disabled={busy}
          aria-label={t('删除划线{0}', existing.note ? t('与笔记') : '')}
          onClick={onRemove}
        >
          {t('删除')}
        </button>
      )}
      <button disabled={busy} onClick={onClose}>
        {t('关闭')}
      </button>
    </div>
  );
}
