// @vitest-environment happy-dom
import { createElement, render } from 'preact';
import { expect, it, vi } from 'vitest';
import { Modal } from './Modal';

it('挂载提交时就进入原生模态状态，避免可见按钮先接收操作后又被showModal抢走焦点', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
  render(
    createElement(Modal, {
      title: '同步弹窗',
      onDismiss: () => {},
      children: createElement('button', null, '首个按钮'),
    }),
    root,
  );
  expect(show).toHaveBeenCalledOnce();
  expect(root.querySelector('dialog')!.open).toBe(true);
  render(null, root);
  root.remove();
  show.mockRestore();
});
