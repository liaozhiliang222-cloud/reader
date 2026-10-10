export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }
}
export async function shareMarkdown(text: string, name: string, title: string) {
  if (!navigator.share) throw new Error('此浏览器不支持分享，请使用下载。');
  const file = new File([text], name, { type: 'text/markdown' });
  if (navigator.canShare?.({ files: [file] }))
    await navigator.share({ files: [file], title });
  else await navigator.share({ title, text });
}
export async function shareBlob(blob: Blob, name: string) {
  if (!navigator.share) throw new Error('此浏览器不支持分享，请使用下载。');
  const file = new File([blob], name, { type: blob.type });
  if (!navigator.canShare?.({ files: [file] }))
    throw new Error('此浏览器无法分享这个文件，请使用下载。');
  await navigator.share({ files: [file], title: name });
}
export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* 接下来使用原生复制命令兜底，失败时保留原选区。 */
  }
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText =
    'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.append(input);
  try {
    input.select();
    if (
      typeof document.execCommand !== 'function' ||
      !document.execCommand('copy')
    )
      throw new Error('复制未被允许，请使用系统选区菜单复制。');
  } finally {
    input.remove();
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
