import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export function Modal({
  title,
  onDismiss,
  children,
  className = '',
  closing = false,
}: {
  title: string;
  onDismiss: () => void;
  children: ComponentChildren;
  className?: string;
  closing?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class={`modal ${className}`}
      aria-label={title}
      aria-hidden={closing || undefined}
      inert={closing}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || closing) return;
        const dialog = event.currentTarget;
        const controls = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]',
          ),
        ].filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility === 'visible' &&
            (!(element instanceof HTMLInputElement) ||
              element.type !== 'radio' ||
              !element.name ||
              element ===
                [
                  ...dialog.querySelectorAll<HTMLInputElement>(
                    'input[type="radio"]',
                  ),
                ]
                  .filter(
                    (radio) =>
                      radio.name === element.name &&
                      radio.form === element.form &&
                      !radio.matches(':disabled'),
                  )
                  .find(
                    (radio, index, group) =>
                      radio.checked ||
                      (index === 0 && !group.some((item) => item.checked)),
                  )),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (
          (!event.shiftKey && document.activeElement === last) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
