import JSZip from 'jszip';
export const compatibilityCases = [
  { name: '普通段落', body: '<h1>开篇</h1><p id="target">微光阅读原创样本。</p>' },
  {
    name: '竖排转统一横排',
    body: '<div style="writing-mode:vertical-rl"><p id="target">春风拂过书页。</p></div>',
  },
  { name: '注音', body: '<p id="target"><ruby>静<rt>jìng</rt></ruby>页</p>' },
  {
    name: '行内注释',
    body: '<p>正文<sup><a href="#target">一</a></sup></p><aside id="target"><p>第一条注释。</p></aside>',
  },
  {
    name: '段前段后列表',
    body: '<ul><li>段前<p id="target">正文</p>段后</li></ul>',
  },
  {
    name: '嵌套列表',
    body: '<ol><li>第一项<ul><li id="target">子项</li></ul></li></ol>',
  },
  {
    name: '诗歌居中换行',
    body: '<p align="center" id="target">风起<br/>纸页轻响<br/>灯未眠</p>',
  },
  {
    name: '预格式文字',
    body: '<pre id="target">第一行\n  第二行\n    第三行</pre>',
  },
  {
    name: '简单表格',
    body: '<table><caption>测试表</caption><tr><th>项目</th><th>值</th></tr><tr id="target"><td>阅读</td><td>三页</td></tr></table>',
  },
  {
    name: '单元格含段落',
    body: '<table><tr id="target"><td><p>甲</p><p>乙</p></td><td><strong>丙</strong></td></tr></table>',
  },
  {
    name: '祖先片段锚点',
    body: '<section id="target"><h2>子节</h2><p>正文。</p></section>',
  },
  { name: '空行内锚点', body: '<p>前文<a id="target"/>目标文字。</p>' },
  {
    name: '强调与上下标',
    body: '<p id="target"><strong>重点</strong><em>强调</em>H<sub>2</sub>O，十<sup>二</sup>。</p>',
  },
  {
    name: '正文散落div',
    body: '<div>导语</div><div id="target">目标段落。</div>',
  },
  {
    name: '引用混合内容',
    body: '<blockquote>引言<p id="target">引用段落。</p>出处</blockquote>',
  },
  {
    name: '外部资源剥离',
    body: '<p id="target" onclick="bad()">保留正文。</p><img src="https://example.invalid/a.png"/><script>bad()</script>',
  },
  {
    name: '实体与特殊字符',
    body: '<p id="target">甲 &amp; 乙 &lt; 丙，&#x1f600;。</p>',
  },
  {
    name: '多层祖先锚点',
    body: '<article><section><div id="target"><p>深层正文。</p></div></section></article>',
  },
  {
    name: '空段与分隔线',
    body: '<p></p><hr/><p id="target">分隔后的正文。</p>',
  },
  {
    name: '超长单段',
    body: '<p id="target">' + '微光阅读原创测试。'.repeat(9000) + '</p>',
  },
];
export async function compatibilityEpub(
  body: string,
  title = '微光阅读自编兼容样本',
) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  );
  zip.file(
    'OPS/book.opf',
    '<package><metadata><title>' +
      title +
      '</title><creator>微光阅读自编测试</creator></metadata><manifest><item id="body" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="body"/></spine></package>',
  );
  zip.file('OPS/chapter.xhtml', '<html><body>' + body + '</body></html>');
  zip.file(
    'OPS/nav.xhtml',
    '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#target">正文目标</a></li></ol></nav></body></html>',
  );
  zip.forEach((_path, entry) => {
    entry.date = new Date('2000-01-01T00:00:00Z');
  });
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
