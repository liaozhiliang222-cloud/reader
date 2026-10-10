import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { format } from 'prettier';
import { chromium, webkit } from '@playwright/test';
const img = (await readFile('public/icons/icon-512.png')).toString('base64');
const reports = [];
const runId = randomUUID();
const directory = 'test-books/ruby-paint/' + runId;
await mkdir(directory, { recursive: true });
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const context = await type.launchPersistentContext('', {
    headless: true,
    viewport: { width: 664, height: 390 },
  });
  try {
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><style>body{margin:0;background:#f5f0e5;color:#322e28;font-family:serif}#root{position:absolute;top:56px;left:24px;width:616px;height:252px;column-width:616px;column-gap:48px;column-fill:auto;font-size:28px;line-height:1.8;text-align:justify;overflow-wrap:anywhere}p{margin:0 0 .5em}img{max-width:100%;max-height:201.6px;object-fit:contain;vertical-align:middle}::highlight(probe){background:#dbcbad;color:#322e28}</style><div id="root"><p><ruby><em>静</em>页<rt>jìngyè</rt></ruby><em>块首正文尾段。</em><img src="data:image/png;base64,${img}"/></p><p>跨段后续😀文本。</p></div>`,
    );
    await page.locator('img').evaluate(async (image) => image.decode());
    const native = await page.evaluate(
      () => typeof Highlight === 'function' && !!CSS.highlights,
    );
    for (const mode of ['none', 'whole', 'text-nodes', 'marks']) {
      const result = await page.evaluate((mode) => {
        CSS.highlights?.clear();
        document.querySelector('#patch')?.remove();
        for (const mark of document.querySelectorAll('mark'))
          mark.replaceWith(...mark.childNodes);
        document.querySelector('#root').normalize();
        const style = document.createElement('style');
        style.id = 'patch';
        if (mode === 'marks')
          style.textContent =
            'mark{font:inherit;background:#dbcbad;color:inherit;padding:0}';
        document.head.append(style);
        const ps = [...document.querySelectorAll('p')];
        const range = document.createRange();
        range.setStart(document.querySelector('ruby em').firstChild, 0);
        range.setEnd(ps[1].firstChild, 6);
        const ranges = [];
        if (mode === 'whole') ranges.push(range);
        if (['text-nodes', 'marks'].includes(mode)) {
          const walker = document.createTreeWalker(
            document.querySelector('#root'),
            NodeFilter.SHOW_TEXT,
          );
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!range.intersectsNode(node)) continue;
            const r = document.createRange();
            r.selectNodeContents(node);
            if (node === range.startContainer)
              r.setStart(node, range.startOffset);
            if (node === range.endContainer) r.setEnd(node, range.endOffset);
            if (!r.collapsed) ranges.push(r);
          }
        }
        if (mode === 'marks') {
          for (const r of [...ranges].reverse()) {
            const mark = document.createElement('mark');
            r.surroundContents(mark);
          }
        } else if (mode !== 'none')
          CSS.highlights.set('probe', new Highlight(...ranges));
        return {
          mode,
          ranges: ranges.map((r) => r.toString()),
          ruby: document.querySelector('ruby').outerHTML,
          rt: document.querySelector('rt').getBoundingClientRect().toJSON(),
        };
      }, mode);
      await page.screenshot({ path: `${directory}/${engine}-${mode}.png` });
      const path = `${directory}/${engine}-${mode}.png`;
      const bytes = await readFile(path);
      reports.push({
        engine,
        native,
        ...result,
        screenshot: {
          path,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      });
    }
  } finally {
    await context.close();
  }
}
await writeFile(
  'artifacts/ruby-paint-native-probe.json',
  await format(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      runId,
      minimalNativeHtml: true,
      applicationOrIndexedDbUsed: false,
      physicalDeviceAcceptance: false,
      automaticPixelAcceptance: false,
      reports,
    }),
    { parser: 'json' },
  ),
);
console.log(
  JSON.stringify(
    reports.map(({ engine, native, mode, ranges }) => ({
      engine,
      native,
      mode,
      ranges,
    })),
  ),
);
