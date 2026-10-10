const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;
const latin = /[A-Za-z\u00c0-\u024f]/g;

/**
 * 按正文抽样判断书写系统：拉丁字母明显多于中日韩文字时标为英文，
 * 让浏览器使用断词，避免两端对齐出现大块词间空白。
 */
export function contentLanguage(paragraphs: readonly string[]): 'en' | 'zh-CN' {
  let sample = '';
  for (const text of paragraphs) {
    sample += text;
    if (sample.length >= 4000) break;
  }
  const han = sample.match(cjk)?.length ?? 0,
    letters = sample.match(latin)?.length ?? 0;
  return letters > 0 && letters > han * 4 ? 'en' : 'zh-CN';
}
