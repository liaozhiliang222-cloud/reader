import { mkdir, writeFile } from 'node:fs/promises';
import { thousandChapterText } from '../src/reader/performanceFixtures.ts';
const directory = 'test-books/performance';
await mkdir(`${directory}/shelf`, { recursive: true });
await writeFile(`${directory}/thousand-chapters.txt`, thousandChapterText());
await writeFile(
  `${directory}/long-paragraph.txt`,
  '第一章 长段落\n' + '静'.repeat(120001),
);
await writeFile(
  `${directory}/many-paragraphs.txt`,
  '第一章 长章节\n' +
    Array.from(
      { length: 1000 },
      (_, index) => `第${index}段` + '静'.repeat(140),
    ).join('\n'),
);
for (let index = 0; index < 100; index++) {
  await writeFile(
    `${directory}/shelf/book-${String(index + 1).padStart(3, '0')}.txt`,
    `第1章 书架样本${index + 1}\n静页自行生成的测试文字，第${index + 1}本书。\n`,
  );
}
await writeFile(
  `${directory}/README.txt`,
  '全部为静页自编样本，不含真实书籍或用户数据。\n千章样本用于打开/跳转，12万字长段和1000段章节用于分块及标注，shelf内100本书可一次多选导入。\n在开发地址加?debug=1查看本地计时；记录实际设备、字号、窗口和首次/再次打开，Android另观察30分钟内存及滚动/翻页帧率。\n这些文件不应提交到仓库。\n',
);
