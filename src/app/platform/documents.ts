import { registerPlugin } from '@capacitor/core';
import { t } from '@/i18n';
import { isIosApp } from './index';

interface Bridge {
  begin(input: { kind: 'pdf' }): Promise<{ handle: string }>;
  append(input: {
    handle: string;
    data: string;
    offset: number;
  }): Promise<void>;
  close(input: { handle: string }): Promise<void>;
  openPdf(input: { handle: string }): Promise<{ pageCount: number }>;
  renderPdf(input: {
    handle: string;
    pageIndex: number;
    width: number;
  }): Promise<{ data: string; width: number; height: number }>;
}
const plugin = registerPlugin<Bridge>('JyDocuments');
const chunkSize = 512 * 1024;
const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};

/** 原页 PDF 由系统 Core Graphics 在本机渲染；只有不透明句柄经过桥。 */
export async function openNativePdf(blob: Blob, signal?: AbortSignal) {
  if (!isIosApp) throw new Error(t('PDF 原页阅读需要 iOS App。'));
  if (blob.size > 50 * 1024 * 1024)
    throw new Error(t('文件超过 50 MB，请拆分后导入。'));
  signal?.throwIfAborted();
  const { handle } = await plugin.begin({ kind: 'pdf' });
  const release = () => {
    void plugin.close({ handle }).catch(() => {});
  };
  signal?.addEventListener('abort', release, { once: true });
  const close = async () => {
    signal?.removeEventListener('abort', release);
    await plugin.close({ handle });
  };
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      signal?.throwIfAborted();
      await plugin.append({
        handle,
        offset,
        data: encode(
          new Uint8Array(
            await blob.slice(offset, offset + chunkSize).arrayBuffer(),
          ),
        ),
      });
    }
    signal?.throwIfAborted();
    const { pageCount } = await plugin.openPdf({ handle });
    signal?.throwIfAborted();
    return {
      pageCount,
      close,
      render: (pageIndex: number, width: number) =>
        plugin.renderPdf({ handle, pageIndex, width }),
    };
  } catch (cause) {
    await close().catch(() => {});
    throw cause;
  }
}
