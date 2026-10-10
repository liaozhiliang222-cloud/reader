// 全部为自编文字，生成到已忽略的测试目录。
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-books', { recursive: true });
await writeFile(
  'test-books/batch-first.txt',
  '第一章 窗边\n这是批量导入的第一本文字样本。\n',
);
await writeFile('test-books/batch-broken.epub', '这不是有效的压缩包。');
await writeFile(
  'test-books/batch-last.txt',
  '第一章 山间\n这是批量导入的第二本文字样本。\n',
);
const paragraphs = Array.from(
  { length: 1000 },
  (_, index) => `第${String(index + 1).padStart(4, '0')}段。` + '静'.repeat(93),
);
await writeFile(
  'test-books/long-article.md',
  '# 手写长文\n\n' +
    paragraphs.slice(0, 500).join('\n\n') +
    '\n\n## 远山\n\n' +
    paragraphs.slice(500).join('\n\n'),
);
