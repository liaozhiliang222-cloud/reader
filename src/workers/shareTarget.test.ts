import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { isShareTarget, receiveShare, readSharedForm } from './shareTarget';
import { createIncomingStore } from '@/db/incoming';
import { createDatabase } from '@/db/schema';
const database = createDatabase('share-post-test');
const scope = 'https://local.test/reader/';
const store = createIncomingStore(scope, indexedDB, database.name);
afterEach(async () => {
  await database.delete();
});
it('POST multipart文件和文字先提交原生IDB再303跳转，重开页面可读取；不拦截外源/其他路径', async () => {
  await database.open();
  const form = new FormData();
  form.append(
    'files',
    new File(['第一章 本地\n分享正文'], '合成.txt', { type: 'text/plain' }),
  );
  form.set('text', '浏览器分享文字');
  form.set('url', 'https://remote.test/article');
  const request = new Request(scope + 'share-target', {
    method: 'POST',
    body: form,
  });
  expect(isShareTarget(request, scope)).toBe(true);
  const response = await receiveShare(request, scope, store);
  expect(response.status).toBe(303);
  const target = new URL(response.headers.get('Location')!);
  expect(target.origin).toBe(new URL(scope).origin);
  const id = target.hash.slice(11),
    data = await store.get(id);
  expect(await data.files[0]!.text()).toContain('分享正文');
  expect(data.text).toBe('浏览器分享文字\n\nhttps://remote.test/article');
  expect(
    isShareTarget(
      new Request('https://remote.test/reader/share-target', {
        method: 'POST',
      }),
      scope,
    ),
  ).toBe(false);
  expect(isShareTarget(new Request(scope + 'share-target'), scope)).toBe(false);
  expect(
    isShareTarget(new Request(scope + 'other', { method: 'POST' }), scope),
  ).toBe(false);
});
it('仅文字/链接分享被保留为纯文本，空分享和损坏格式不写库，存储失败返回可重试的错误页', async () => {
  await database.open();
  const form = new FormData();
  form.set('text', '<script>原样文字</script>');
  const response = await receiveShare(
    new Request(scope + 'share-target', { method: 'POST', body: form }),
    scope,
    store,
  );
  expect(
    (await store.get(new URL(response.headers.get('Location')!).hash.slice(11)))
      .text,
  ).toBe('<script>原样文字</script>');
  const count = (await store.list()).length;
  const empty = await receiveShare(
    new Request(scope + 'share-target', {
      method: 'POST',
      body: new FormData(),
    }),
    scope,
    store,
  );
  expect(empty.headers.get('Location')).toContain('error-format');
  expect((await store.list()).length).toBe(count);
  const failing = createIncomingStore(scope, indexedDB, 'share-uninitialized');
  const failed = await receiveShare(
    new Request(scope + 'share-target', { method: 'POST', body: form }),
    scope,
    failing,
  );
  expect(failed.headers.get('Location')).toContain('error-storage');
});
it('无Content-Length也按实际流字节终止，未知大字段同样受限，不信任声明长度', async () => {
  const form = new FormData();
  form.set('ignored', 'x'.repeat(2000));
  const request = () =>
    new Request(scope + 'share-target', { method: 'POST', body: form });
  await expect(readSharedForm(request(), 512)).rejects.toThrow('过大');
  const forged = request();
  forged.headers.set('Content-Length', '1');
  await expect(readSharedForm(forged, 512)).rejects.toThrow('过大');
  const largeHeader = request();
  largeHeader.headers.set('Content-Length', '99999');
  await expect(readSharedForm(largeHeader, 512)).rejects.toThrow('过大');
});
