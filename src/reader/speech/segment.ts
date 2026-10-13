/**
 * 段落切句：中英文标点规则，超长句再切，全部按 UTF-16 偏移记录。
 * 只返回 [start, end) 区间，切分不改动原文、不切开代理对。
 */

export interface SentenceSpan {
  start: number;
  end: number;
}

/** 句末终止符（中文句读 + 英文）。 */
const TERMINATORS = new Set('。！？；…!?'.split(''));
/** 紧跟在终止符后的收尾符号，归入同一句。 */
const CLOSERS = new Set(
  '”’」』）】》〉"\'!?．.。…·—–-~～'
    .split('')
    .concat(['!', '?', ')', ']', '}']),
);
/** 英文缩写：点号后不视为句末。 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'jr',
  'sr',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'no',
  'fig',
  'al',
  'cf',
  'eg',
  'ie',
  'inc',
  'ltd',
  'co',
  'approx',
  'dept',
  'est',
]);
/** 超过该长度（UTF-16 码元）的句子再按从属标点切分。 */
const SOFT_LIMIT = 120;
/** 硬上限：仍超长时按长度切断。 */
const HARD_LIMIT = 200;
const SECONDARY = new Set('，、：；,;—–-'.split(''));

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '　';
const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);

/** 判断英文点号在 index 处是否真的是句末。 */
function isSentenceDot(text: string, index: number): boolean {
  // 小数点：两侧都是数字则不是句末（含 3.14、版本号 1.0.1）。
  const prev = text[index - 1] ?? '',
    next = text[index + 1] ?? '';
  if (/[0-9]/.test(prev) && /[0-9]/.test(next)) return false;
  // 连续点号（省略号 ...）：最后一个才算结束。
  if (prev === '.' || next === '.') return false;
  // 取点号前的单词判断缩写与首字母缩写（A. B.）。
  let from = index - 1;
  while (from >= 0 && isWord(text[from]!)) from--;
  const word = text.slice(from + 1, index).toLowerCase();
  if (!word) return false;
  if (word.length === 1) return false; // 人名首字母缩写、列表标号
  if (ABBREVIATIONS.has(word)) return false;
  // e.g. / i.e. 这类带点缩写已被 ABBREVIATIONS 覆盖；
  // 带连字符或多段的缩写（a.m. p.m. U.S.）看上一段是否仍是单字母+点。
  if (/^[a-z]$/.test(word[0]!) && text[from] === '.') return false;
  return true;
}

function isTerminator(text: string, index: number): boolean {
  const ch = text[index]!;
  if (ch === '.') return isSentenceDot(text, index);
  return TERMINATORS.has(ch);
}

/** 跳过空白并返回首个非空白位置；全是空白时返回 end。 */
function trimStart(text: string, from: number, end: number): number {
  let i = from;
  while (i < end && (isSpace(text[i]!) || text[i] === '\n')) i++;
  return i;
}
function trimEnd(text: string, start: number, end: number): number {
  let i = end;
  while (i > start && (isSpace(text[i - 1]!) || text[i - 1] === '\n')) i--;
  return i;
}

/** 硬切时向前退让到安全边界：不切开代理对，优先落在空白后。 */
function hardCut(text: string, start: number, end: number): number {
  let cut = Math.min(start + HARD_LIMIT, end);
  // 回退最近的空白，最多退让 20 个码元。
  const floor = cut - 20;
  for (let i = cut; i > floor && i > start + 1; i--) {
    const ch = text[i - 1]!;
    if (isSpace(ch) || ch === '\n') {
      cut = i;
      break;
    }
  }
  // 不把代理对劈开。
  if (cut < end && isHighSurrogate(text.charCodeAt(cut - 1))) cut--;
  if (cut <= start) cut = Math.min(start + HARD_LIMIT, end);
  return cut;
}

/** 把 [start,end) 内的长句按从属标点二次切分。 */
function* splitLong(
  text: string,
  start: number,
  end: number,
): Generator<SentenceSpan> {
  let head = start;
  while (end - head > SOFT_LIMIT) {
    const limit = Math.min(head + SOFT_LIMIT, end);
    let cut = -1;
    for (let i = limit; i > head; i--) {
      const ch = text[i - 1]!;
      if (SECONDARY.has(ch) || ch === '、' || ch === '，' || ch === '：') {
        cut = i;
        break;
      }
    }
    if (cut < 0 || cut <= head) cut = hardCut(text, head, end);
    yield { start: head, end: cut };
    head = cut;
  }
  if (head < end) yield { start: head, end };
}

/**
 * 把一段可读文本切成句子区间。空白与纯标点段不产生句子。
 * 句子区间首尾自动去掉空白；输入为空或全空白时返回空数组。
 */
export function segmentText(text: string): SentenceSpan[] {
  const result: SentenceSpan[] = [];
  let sentenceStart = 0;
  const end = text.length;
  for (let i = 0; i < end; i++) {
    if (!isTerminator(text, i)) continue;
    // 吃掉紧随终止符的收尾符号（引号、括号、叠用的叹号问号等）。
    let tail = i + 1;
    while (tail < end && CLOSERS.has(text[tail]!)) tail++;
    const piece = text.slice(sentenceStart, tail);
    const a = trimStart(text, sentenceStart, tail),
      b = trimEnd(text, a, tail);
    // 纯标点/空白段不构成句子。
    if (b > a && /[\p{L}\p{N}\p{S}]/u.test(piece)) {
      if (b - a > SOFT_LIMIT) result.push(...splitLong(text, a, b));
      else result.push({ start: a, end: b });
    }
    sentenceStart = tail;
    i = tail - 1;
  }
  if (sentenceStart < end) {
    const a = trimStart(text, sentenceStart, end),
      b = trimEnd(text, a, end);
    const piece = text.slice(a, b);
    if (b > a && /[\p{L}\p{N}\p{S}]/u.test(piece)) {
      if (b - a > SOFT_LIMIT) result.push(...splitLong(text, a, b));
      else result.push({ start: a, end: b });
    }
  }
  return result;
}
