// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { copyText, downloadBlob, shareMarkdown } from './files';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'execCommand');
});
it('复制在 Clipboard 拒绝时兜底，成功与失败都还原原选区并清理临时输入框', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  const p = document.createElement('p');
  p.textContent = '甲乙丙丁';
  document.body.append(p);
  const range = document.createRange();
  range.setStart(p.firstChild!, 1);
  range.setEnd(p.firstChild!, 3);
  const selection = window.getSelection()!;
  selection.addRange(range);
  const command = vi.fn(() => {
    expect(document.querySelector('textarea')?.value).toBe('摘录😀');
    return true;
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: command,
  });
  await copyText('摘录😀');
  expect(command).toHaveBeenCalledWith('copy');
  expect(selection.toString()).toBe('乙丙');
  expect(document.querySelector('textarea')).toBeNull();
  command.mockImplementation(() => false);
  await expect(copyText('摘录😀')).rejects.toThrow('系统选区');
  expect(selection.toString()).toBe('乙丙');
  expect(document.querySelector('textarea')).toBeNull();
});
it('优先使用 Clipboard，不额外改动选区', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await copyText('摘录');
  expect(writeText).toHaveBeenCalledWith('摘录');
  expect(document.querySelector('textarea')).toBeNull();
});
it('下载设置 Markdown 文件名，触发后移除链接并延迟释放 Blob URL', () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn().mockReturnValue('blob:local'),
    revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('书_笔记.md');
      expect(this.getAttribute('href')).toBe('blob:local');
      expect(this.isConnected).toBe(true);
    });
  downloadBlob(new Blob(['# 书']), '书_笔记.md');
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a')).toBeNull();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(15_000);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:local');
});
it('支持文件分享时发送 Markdown 文件，纯文本分享兜底；取消不自动重发', async () => {
  const share = vi.fn().mockResolvedValue(undefined),
    canShare = vi.fn().mockReturnValue(true);
  vi.stubGlobal('navigator', { share, canShare });
  await shareMarkdown('# 书\n\n> 原文', '书_笔记.md', '书');
  const data = share.mock.calls[0]![0] as ShareData;
  expect(data.files?.[0]?.name).toBe('书_笔记.md');
  expect(data.files?.[0]?.type).toBe('text/markdown');
  expect(await data.files?.[0]?.text()).toBe('# 书\n\n> 原文');
  canShare.mockReturnValue(false);
  await shareMarkdown('# 书', '书_笔记.md', '书');
  expect(share).toHaveBeenLastCalledWith({ title: '书', text: '# 书' });
  share.mockRejectedValue(new DOMException('cancel', 'AbortError'));
  await expect(shareMarkdown('# 书', '书_笔记.md', '书')).rejects.toThrow(
    'cancel',
  );
  expect(share).toHaveBeenCalledTimes(3);
});
