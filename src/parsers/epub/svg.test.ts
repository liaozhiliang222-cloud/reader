import { expect, it } from 'vitest';
import { sanitizeSvg, svgLocalImages } from './svg';
import { parseXml } from './xml';
import { parseEpub } from './parse';
import { svgEpub } from './svgFixture';

const ns = 'xmlns="http://www.w3.org/2000/svg"';
it('静态图形、简单样式级联和同文档 use 保留；所有输出是重建的 XML', () => {
  const output =
    sanitizeSvg(`<svg ${ns} viewBox="0 0 200 100" width="200" height="100">
    <style>@font-face {src:url(https://bad.test/font)} .box {fill:none;stroke:#666} rect {fill:red} #target {stroke:blue} .box {stroke-width:2}</style>
    <defs><path id="shape" d="M0 0L10 10"/></defs><rect id="target" class="box" x="10" y="20" width="60" height="30" style="stroke:green"/>
    <use href="#shape" x="20" y="30"/><text x="10" y="75" font-size="18">甲 &amp; 乙<tspan dy="1">说明</tspan></text></svg>`)!;
  const doc = parseXml(output);
  expect(doc.documentElement?.getAttribute('viewBox')).toBe('0 0 200 100');
  const rect = doc.getElementsByTagName('rect')[0]!;
  expect(rect.getAttribute('fill')).toBe('none');
  expect(rect.getAttribute('stroke')).toBe('green');
  expect(rect.getAttribute('stroke-width')).toBe('2');
  expect(doc.getElementsByTagName('path')).toHaveLength(2);
  expect(doc.getElementsByTagName('text')[0]?.textContent).toBe('甲 & 乙说明');
  expect(output).toContain('translate(20 30)');
  expect(output).not.toMatch(
    /bad\.test|font-face|style=|<style|class=|href=|<use/,
  );
});
it('脚本、外链、foreignObject、事件、动画、命名空间欺骗及危险 CSS 全部移除', () => {
  const output =
    sanitizeSvg(`<svg ${ns} xmlns:xlink="http://www.w3.org/1999/xlink" onload="bad()">
    <script>bad()</script><foreignObject><rect width="9"/><iframe src="https://bad.test"/></foreignObject>
    <style>.box {fill:url(https://bad.test);stroke:url(\\23 bad);filter:url(#danger);font-family:remote}</style>
    <image xlink:href="https://bad.test/i"/><use xlink:href="other.svg#x"/><animate attributeName="href" to="https://bad.test"/>
    <path xmlns="http://bad.test" d="M0 0"/><rect class="box" width="40" height="30" onclick="bad()" constructor="evil" __proto__="evil" style="fill:url(data:image/svg+xml,x);stroke:blue;constructor:evil;__proto__:evil"/><text>&lt;script&gt;bad()&lt;/script&gt;</text></svg>`)!;
  const doc = parseXml(output);
  expect(doc.getElementsByTagName('rect')).toHaveLength(1);
  expect(doc.getElementsByTagName('path')).toHaveLength(0);
  expect(doc.getElementsByTagName('rect')[0]?.getAttribute('fill')).toBeNull();
  expect(doc.getElementsByTagName('rect')[0]?.getAttribute('stroke')).toBe(
    'blue',
  );
  expect(output).not.toMatch(
    /https?:\/\/bad|xlink|foreignObject|iframe|onload|onclick|animate|<script|href|url\(/,
  );
  expect(doc.getElementsByTagName('text')[0]?.textContent).toBe(
    '<script>bad()</script>',
  );
});
it('仅允许同图内的渐变和裁剪引用；递归 use 不生成循环引用', () => {
  const output = sanitizeSvg(
    `<svg ${ns}><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#000"/></linearGradient><clipPath id="clip"><rect width="10" height="10"/></clipPath><g id="cycle"><use href="#cycle"/></g></defs><rect width="10" height="10" fill="url(#g)" clip-path="url(#clip)"/><use href="#cycle"/></svg>`,
  )!;
  expect(output).toContain('<linearGradient');
  expect(output).toContain('gradientUnits="userSpaceOnUse"');
  expect(output).toContain('fill="url(#g)"');
  expect(output).not.toContain('href');
  expect(output.length).toBeLessThan(1000);
});
it('过大、过深或重复引用展开过多的图明确拒绝，不无限解析', () => {
  expect(() =>
    sanitizeSvg(`<svg ${ns}>${' '.repeat(1024 * 1024)}</svg>`),
  ).toThrow('安全处理范围');
  expect(() =>
    sanitizeSvg(
      `<svg ${ns}>${'<g>'.repeat(65)}<rect/>${'</g>'.repeat(65)}</svg>`,
    ),
  ).toThrow('安全处理范围');
  let defs = '<g id="g0"><rect width="1" height="1"/></g>';
  for (let n = 1; n < 16; n++)
    defs += `<g id="g${n}"><use href="#g${n - 1}"/><use href="#g${n - 1}"/></g>`;
  expect(() =>
    sanitizeSvg(`<svg ${ns}><defs>${defs}</defs><use href="#g15"/></svg>`),
  ).toThrow('安全处理范围');
});
it('SVG 包装只恢复已解析的书内图像，不遍历危险容器或外链', () => {
  const root = parseXml(
    `<svg ${ns} xmlns:xlink="http://www.w3.org/1999/xlink"><g><image xlink:href="../cover.png"/></g><image href="https://bad.test/a"/><foreignObject><image href="../cover.png"/></foreignObject></svg>`,
  ).documentElement!;
  expect(sanitizeSvg(root)).toBeUndefined();
  expect(
    svgLocalImages(
      root,
      'OPS/text/chapter.xhtml',
      new Map([['OPS/cover.png', 'local']]),
    ),
  ).toEqual([{ tag: 'img', children: [], imageId: 'local', alt: '' }]);
});

it('新 EPUB v3恢复包装封面与矢量图，v1/v2仍保持原有段落和锚点', async () => {
  const bytes = await svgEpub();
  for (const version of [1, 2] as const) {
    const old = await parseEpub(bytes, 'book', version);
    expect(old.chapters[0]?.paragraphs).toEqual(['正文位置', '']);
    expect(old.chapters[0]?.anchors.target).toBe(0);
    expect(old.assets).toHaveLength(1);
  }
  const current = await parseEpub(bytes, 'book');
  expect(current.parserVersion).toBe(3);
  expect(current.chapters[0]?.paragraphs).toEqual(['', '正文位置', '', '']);
  expect(current.chapters[0]?.anchors).toEqual({ cover: 0, target: 1 });
  expect(current.toc[0]?.paragraphIndex).toBe(1);
  expect(current.assets.map((asset) => asset.data.type)).toEqual([
    'image/png',
    'image/svg+xml',
    'image/svg+xml',
  ]);
  expect(await current.assets[1]!.data.text()).not.toContain('script');
});
