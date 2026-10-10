import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';
import {
  openShelf,
  importBook,
  menu,
  nextPage,
  backToShelf,
  paragraphs,
} from './helpers';
import { updateData } from './updateData';
import { compatibilityEpub } from '../src/parsers/epub/compatFixtures';
import type { Book, Progress } from '../src/types';

interface Evidence {
  workers: string[];
  external: string[];
  errors: string[];
  posts: { status: number; fromServiceWorker: boolean; location: string }[];
  details: Record<string, unknown>;
}
const test = base.extend<{ evidence: Evidence }>({
  evidence: async ({ context, baseURL }, use, info) => {
    if (!baseURL) throw new Error('Missing preview URL');
    const origin = new URL(baseURL).origin;
    const evidence: Evidence = {
      workers: [],
      external: [],
      errors: [],
      posts: [],
      details: {},
    };
    const watch = (page: Page) => {
      page.on('pageerror', (error) => evidence.errors.push(error.message));
      page.on('worker', (worker) => evidence.workers.push(worker.url()));
    };
    context.pages().forEach(watch);
    context.on('page', watch);
    context.on('request', (request) => {
      if (
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== origin
      )
        evidence.external.push(request.url());
    });
    await use(evidence);
    expect(evidence.external).toEqual([]);
    expect(evidence.errors).toEqual([]);
    const runId = process.env.JINGYE_SHARING_RUN;
    if (!runId) throw new Error('Missing sharing run ID');
    await writeFile(
      `.e2e-sharing/${runId}/${info.project.name}-${info.title.split('：')[0]}.json`,
      JSON.stringify(
        {
          runId,
          checkedAt: new Date().toISOString(),
          engine: info.project.name,
          title: info.title,
          status: info.status,
          origin,
          ...evidence,
          automaticCspGuard: true,
          physicalSystemShareAcceptance: false,
        },
        null,
        2,
      ) + '\n',
    );
  },
});
test.setTimeout(120_000);
const active = (page: Page) =>
  page.locator('.reader-content:not([aria-hidden="true"])');
const sha = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

// Browser form navigation enters the deployed SW POST handler. No direct IDB
// writes, mocked RPC, launchQueue shim, or intercepted import responses.
async function share(
  page: Page,
  evidence: Evidence,
  data: {
    files?: { name: string; mimeType: string; buffer: Buffer }[];
    title?: string;
    text?: string;
    url?: string;
  },
) {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state))
    .toBe('activated');
  await page.evaluate(async () => {
    const response = await fetch('./manifest.webmanifest');
    const manifest: unknown = await response.json();
    if (
      !manifest ||
      typeof manifest !== 'object' ||
      !('share_target' in manifest)
    )
      throw new Error('Missing share target');
    const target = manifest.share_target;
    if (
      !target ||
      typeof target !== 'object' ||
      !('action' in target) ||
      typeof target.action !== 'string' ||
      !('method' in target) ||
      target.method !== 'POST' ||
      !('enctype' in target) ||
      target.enctype !== 'multipart/form-data'
    )
      throw new Error('Invalid native share target declaration');
    const form = document.createElement('form');
    form.id = 'e2e-native-share';
    form.action = target.action;
    form.method = target.method;
    form.enctype = target.enctype;
    for (const name of ['title', 'text', 'url']) {
      const field = document.createElement('textarea');
      field.name = name;
      field.setAttribute('aria-label', `测试分享-${name}`);
      form.append(field);
    }
    const files = document.createElement('input');
    files.type = 'file';
    files.name = 'files';
    files.multiple = true;
    files.setAttribute('aria-label', '测试分享文件');
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = '提交测试分享';
    form.append(files, button);
    document.body.append(form);
  });
  for (const name of ['title', 'text', 'url'] as const)
    await page
      .getByLabel(`测试分享-${name}`, { exact: true })
      .fill(data[name] ?? '');
  const files = page.getByLabel('测试分享文件', { exact: true });
  if (data.files?.length) await files.setInputFiles(data.files);
  else
    await files.evaluate((element) => {
      (element as HTMLInputElement).disabled = true;
    });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/share-target'),
  );
  await page.getByRole('button', { name: '提交测试分享', exact: true }).click();
  const response = await responsePromise;
  const record = {
    status: response.status(),
    fromServiceWorker: response.fromServiceWorker(),
    location: (await response.allHeaders()).location ?? '',
  };
  evidence.posts.push(record);
  expect(record.status).toBe(303);
  expect(record.fromServiceWorker).toBe(true);
  expect(record.location).toMatch(/#\/incoming\/[0-9a-f-]{36}$/);
  expect(response.request().isNavigationRequest()).toBe(true);
  return new URL(record.location).hash.slice('#/incoming/'.length);
}

async function pending(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jingye');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise<unknown[]>((resolve, reject) => {
        const request = database
          .transaction('blobs', 'readonly')
          .objectStore('blobs')
          .getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
      const items = [];
      for (const record of records) {
        if (
          !record ||
          typeof record !== 'object' ||
          !('id' in record) ||
          typeof record.id !== 'string' ||
          !record.id.startsWith('incoming:')
        )
          continue;
        if (
          !('data' in record) ||
          !(record.data instanceof Blob) ||
          !('type' in record) ||
          typeof record.type !== 'string' ||
          !('value' in record)
        )
          throw new Error('Invalid pending record');
        const form = await new Response(record.data, {
          headers: { 'Content-Type': record.type },
        }).formData();
        const files = [];
        for (const file of form.getAll('files')) {
          if (typeof file === 'string')
            throw new Error('Expected real shared file');
          const hash = await crypto.subtle.digest(
            'SHA-256',
            await file.arrayBuffer(),
          );
          files.push({
            name: file.name,
            size: file.size,
            type: file.type,
            sha256: Array.from(new Uint8Array(hash), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
          });
        }
        items.push({ id: record.id, value: record.value, files });
      }
      return items;
    } finally {
      database.close();
    }
  });
}

test('SHARE-FILE：真实multipart导航由SW接收EPUB，自动阅读且另一标签的进度书签保留', async ({
  page,
  context,
  evidence,
  browserName,
}) => {
  await openShelf(page);
  await importBook(page, 'txt');
  await nextPage(page, 2);
  await menu(page);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await backToShelf(page);
  const saved = await updateData(page);
  await page.locator('.shelf-entry').click();
  await expect(active(page)).toBeVisible();
  const originalUrl = page.url();
  const inbox = await context.newPage();
  await inbox.goto('/');
  const buffer = Buffer.from(
    await compatibilityEpub(
      '<p id="target">分享进入的原创正文。</p>' +
        paragraphs.map((p) => `<p>${p}</p>`).join(''),
      '分享原创EPUB',
    ),
  );
  // Windows WebKit native formData treats a UTF-8 filename as a text field.
  // scripts/probe-sharing.mjs reproduces this without any application code.
  const fileName = browserName === 'webkit' ? 'shared.epub' : '分享原创.epub';
  const id = await share(inbox, evidence, {
    files: [{ name: fileName, mimeType: 'application/epub+zip', buffer }],
  });
  await expect(active(inbox)).toBeVisible();
  await expect(active(inbox)).toContainText('分享进入的原创正文');
  await expect.poll(() => pending(inbox)).toEqual([]);
  expect(page.url()).toBe(originalUrl);
  await expect(active(page)).toContainText(paragraphs[0]!);
  await backToShelf(page);
  const after = await updateData(page);
  expect(after.books).toHaveLength(2);
  expect(after.bookmarks).toEqual(saved.bookmarks);
  const oldProgress = (saved.progress as unknown as Progress[])[0]!;
  expect(
    (after.progress as unknown as Progress[]).find(
      (row) => row.bookId === oldProgress.bookId,
    )?.locator,
  ).toEqual(oldProgress.locator);
  for (const blob of saved.blobs ?? [])
    expect(after.blobs).toContainEqual(blob);
  const imported = (after.books as unknown as Book[]).find(
    (book) => book.type === 'epub',
  )!;
  expect(after.blobs).toContainEqual({
    id: imported.fileBlobId,
    size: buffer.length,
    type: 'application/epub+zip',
    sha256: sha(buffer),
  });
  evidence.details = {
    incomingId: id,
    consumed: true,
    originalShaEqual: true,
    oldReadingAndBookmarkPreserved: true,
    fileNames: [fileName],
    bookCount: 2,
  };
});

test('SHARE-TEXT：分享文字和URL只作文本，返回/重载保留预填，保存后消费暂存', async ({
  page,
  evidence,
}) => {
  await openShelf(page);
  const title = '分享长文';
  const text =
    '# 分享小节\n\n原创第一段，😀。\n\n<script>不执行的正文</script>';
  const url = 'https://example.invalid/share-must-not-fetch';
  const expected = `${text}\n\n${url}`;
  const transmitted = `${text.replace(/\n/g, '\r\n')}\n\n${url}`;
  const id = await share(page, evidence, { title, text, url });
  await expect(page.getByRole('heading', { name: '粘贴长文' })).toBeVisible();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(expected);
  await expect(page.getByLabel('标题（选填）')).toHaveValue(title);
  const staged = await pending(page);
  expect(staged).toHaveLength(1);
  expect(staged[0]!.value).toEqual({ title, text: transmitted, errors: [] });
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(
    page.getByText('有 1 份分享尚未处理，原文仍在本机。'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '继续导入分享', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(expected);
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await expect(active(page)).toBeVisible();
  await expect.poll(() => pending(page)).toEqual([]);
  const snapshot = await updateData(page);
  expect(snapshot.books).toHaveLength(1);
  const book = (snapshot.books as unknown as Book[])[0]!;
  expect(book.type).toBe('paste');
  expect(book.title).toBe(title);
  expect(snapshot.blobs).toContainEqual({
    id: book.draftBlobId,
    size: Buffer.byteLength(transmitted),
    type: 'text/plain;charset=utf-8',
    sha256: sha(Buffer.from(transmitted)),
  });
  evidence.details = {
    incomingId: id,
    textAndUrlPreserved: true,
    reloadBeforeSave: true,
    consumedAfterSave: true,
    originalShaEqual: true,
    bookCount: 1,
  };
});

test('SHARE-MIXED：混合分享保留失败文件并可重试，保存文字不丢文件，另一标签文稿不变', async ({
  page,
  context,
  evidence,
  browserName,
}) => {
  await openShelf(page);
  const editor = await context.newPage();
  await editor.goto('/#/paste');
  await editor.getByLabel('标题（选填）').fill('尚未保存的文稿');
  await editor
    .getByLabel('正文', { exact: true })
    .fill('这段尚未保存的原创内容不能被分享覆盖。');
  const good = Buffer.from(
    '第一章 混合成功\n这是从真实分享POST进入的原创TXT。',
  );
  const bad = Buffer.from('损坏的原创EPUB测试字节');
  const goodName = browserName === 'webkit' ? 'mixed.txt' : '混合成功.txt';
  const badName = browserName === 'webkit' ? 'broken.epub' : '损坏.epub';
  const id = await share(page, evidence, {
    title: '混合文字',
    text: '另存为文稿的原创分享文字。',
    files: [
      { name: goodName, mimeType: 'text/plain', buffer: good },
      { name: badName, mimeType: 'application/epub+zip', buffer: bad },
    ],
  });
  await expect(
    page.getByText('未导入文件已留在本机，返回书架后可重新处理。'),
  ).toBeVisible();
  await expect(page.locator('.import-results li')).toHaveCount(2);
  const before = await pending(page);
  expect(before).toHaveLength(1);
  expect(before[0]!.files).toEqual([
    {
      name: badName,
      size: bad.length,
      type: 'application/epub+zip',
      sha256: sha(bad),
    },
  ]);
  const original = await updateData(page);
  expect(original.books).toHaveLength(1);
  expect(original.blobs).toContainEqual(
    expect.objectContaining({ sha256: sha(good) }),
  );
  await page
    .getByRole('button', { name: '重试未导入文件', exact: true })
    .click();
  await expect(page.locator('.import-results li')).toHaveCount(1);
  await expect(page.locator('.import-results li')).toContainText('导入失败');
  expect(await pending(page)).toEqual(before);
  await page.getByRole('button', { name: '检查分享文字', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(
    '另存为文稿的原创分享文字。',
  );
  await page.getByRole('button', { name: '开始阅读', exact: true }).click();
  await expect(active(page)).toBeVisible();
  const remaining = await pending(page);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.files).toEqual(before[0]!.files);
  expect(remaining[0]!.value).toEqual({ title: '', text: '', errors: [] });
  await expect(editor.getByLabel('标题（选填）')).toHaveValue('尚未保存的文稿');
  await expect(editor.getByLabel('正文', { exact: true })).toHaveValue(
    '这段尚未保存的原创内容不能被分享覆盖。',
  );
  expect(new URL(editor.url()).hash).toBe('#/paste');
  await backToShelf(page);
  await page.getByRole('button', { name: '继续导入分享', exact: true }).click();
  await page
    .getByRole('button', { name: '放弃这份待导入分享', exact: true })
    .click();
  await expect.poll(() => pending(page)).toEqual([]);
  const after = await updateData(page);
  expect(after.books).toHaveLength(2);
  expect(after.blobs).toContainEqual(
    expect.objectContaining({ sha256: sha(good) }),
  );
  evidence.details = {
    incomingId: id,
    retryOnlyFailedFile: true,
    badFileHashPreserved: true,
    savedTextKeepsFailedFile: true,
    unsavedEditorUnchanged: true,
    explicitDiscardOnly: true,
    fileNames: [goodName, badName],
    bookCount: 2,
  };
});
