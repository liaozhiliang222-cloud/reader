// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fontBytes = vi.hoisted(() => new TextEncoder().encode('fake-font-bytes'));
const blobs = vi.hoisted(() => ({
  rows: new Map<string, { id: string; data: Blob }>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
}));
vi.mock('./fontAsset.json', async () => {
  const { createHash } = await import('node:crypto');
  return {
    file: 'fonts/test.woff2',
    size: fontBytes.byteLength,
    sha256: createHash('sha256').update(fontBytes).digest('hex'),
  };
});
vi.mock('@/db/index', () => ({
  db: {
    blobs: {
      get: async (id: string) => blobs.rows.get(id),
      put: async (row: { id: string; data: Blob }) => {
        blobs.rows.set(row.id, row);
      },
      delete: async (id: string) => {
        blobs.rows.delete(id);
      },
    },
  },
}));

const fontId = () =>
  'font:' +
  new URL(import.meta.env.BASE_URL + 'fonts/test.woff2', location.origin).href;

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(new Blob([fontBytes]))),
);
vi.stubGlobal(
  'FontFace',
  class {
    async load() {
      return this;
    }
  },
);
Object.defineProperty(document, 'fonts', {
  value: { add: vi.fn(), delete: vi.fn() },
  configurable: true,
});

async function freshModule() {
  vi.resetModules();
  return import('./optionalFont');
}

describe('optionalFont（iOS：Cache API 不接受 capacitor://，改存 IndexedDB）', () => {
  beforeEach(() => {
    blobs.rows.clear();
  });

  it('下载成功时把字体字节写入 blobs 并标记 ready', async () => {
    const mod = await freshModule();
    await mod.downloadOptionalFont();
    expect(mod.fontState.value.phase).toBe('ready');
    const row = blobs.rows.get(fontId());
    expect(row?.data.size).toBe(fontBytes.byteLength);
  });

  it('重启后从 blobs 恢复字体，删除时同步清除', async () => {
    blobs.rows.set(fontId(), {
      id: fontId(),
      data: new Blob([fontBytes]),
    });
    const mod = await freshModule();
    await mod.restoreOptionalFont();
    expect(mod.fontState.value.phase).toBe('ready');
    await mod.removeOptionalFont();
    expect(blobs.rows.has(fontId())).toBe(false);
    expect(mod.fontState.value.phase).toBe('idle');
  });
});
