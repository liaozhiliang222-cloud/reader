import { mkdir, writeFile } from 'node:fs/promises';
import {
  compatibilityCases,
  compatibilityEpub,
} from '../src/parsers/epub/compatFixtures.ts';
await mkdir('test-books/generated-compat', { recursive: true });
const rows = [];
for (const [index, sample] of compatibilityCases.entries()) {
  const name = `case-${String(index + 1).padStart(2, '0')}.epub`;
  await writeFile(
    `test-books/generated-compat/${name}`,
    new Uint8Array(await compatibilityEpub(sample.body, sample.name)),
  );
  rows.push(
    `| ${index + 1} | [${sample.name}](generated-compat/${name}) | 静页原创合成 | compat.test.ts | 待验收 |`,
  );
}
const report =
  '# EPUB兼容记录\n\n本表20份文件均为静页原创合成样本，覆盖不同结构，不是20本不同来源真实EPUB。不能据此将M2-10整体验收标为通过。\n\n自动解析命令：pnpm test -- src/parsers/epub/compat.test.ts。真实浏览器仍需逐本检查目录跳转、分页边界、图片、原生选区和可访问性。字体混淆、损坏包及编码另见encryption.test.ts、zip.test.ts、normalize.test.ts。\n\n| 序号 | 文件/结构 | 来源 | 自动检查 | 浏览器/真机 |\n| --- | --- | --- | --- | --- |\n' +
  rows.join('\n') +
  '\n\n## 真实来源样本待补\n\n后续为20本以上不同来源的合法EPUB记录原始页面、下载时间、授权/公版依据、SHA256、结构问题、修复及浏览器证据；不把合成样本冒充真实兼容集。\n';
try {
  await writeFile('test-books/COMPAT.md', report, { flag: 'wx' });
} catch (error) {
  if (!(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST'
  ))
    throw error;
}
await writeFile(
  'test-books/generated-compat/README.txt',
  '全部为原创样本，ZIP时间固定以保持指纹稳定。根目录COMPAT.md首次生成后不覆盖人工记录。\n',
);
