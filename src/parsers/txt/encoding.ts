export type TextEncoding =
  'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5';

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
}

export class TextDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextDecodingError';
  }
}

function decode(bytes: Uint8Array, encoding: TextEncoding): DecodedText {
  return {
    text: new TextDecoder(encoding, { fatal: true }).decode(bytes),
    encoding,
  };
}

/** 只检测有明显 ASCII/空白字节特征的 UTF-16，不猜测无 BOM 的纯中文。 */
function detectUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | undefined {
  if (bytes.length % 2 !== 0) return;
  const pairs = Math.min(bytes.length / 2, 2048);
  if (pairs < 4) return;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < pairs * 2; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  if (oddZeros / pairs >= 0.3 && evenZeros / pairs <= 0.05) return 'utf-16le';
  if (evenZeros / pairs >= 0.3 && oddZeros / pairs <= 0.05) return 'utf-16be';
}

/**
 * 原生解码，不清洗正文。GBK/GB2312 统一返回兼容它们的 gb18030 标签。
 * 编码无 BOM 时并不唯一：按产品约定优先 GB18030，不能保证自动区分 Big5。
 */
export function decodeText(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);
  const startsWith = (...prefix: number[]) =>
    prefix.every((byte, index) => bytes[index] === byte);

  // UTF-32LE 的标记以 UTF-16LE 开头，必须先排除。
  if (startsWith(0xff, 0xfe, 0, 0) || startsWith(0, 0, 0xfe, 0xff)) {
    throw new TextDecodingError(
      t('暂不支持 UTF-32，请将文件转换为 UTF-8 后导入。'),
    );
  }

  const bomEncoding = startsWith(0xef, 0xbb, 0xbf)
    ? 'utf-8'
    : startsWith(0xff, 0xfe)
      ? 'utf-16le'
      : startsWith(0xfe, 0xff)
        ? 'utf-16be'
        : undefined;

  if (bomEncoding) {
    try {
      return decode(bytes, bomEncoding);
    } catch {
      // 有明确标记却损坏时不能换编码掩盖错误。
      throw new TextDecodingError(
        t('文件标记为 {0}，但内容损坏或不完整。', bomEncoding),
      );
    }
  }

  // ASCII UTF-16 字节也可能通过 UTF-8 校验，因此零字节特征优先检查。
  const utf16 = detectUtf16(bytes);
  if (utf16) {
    try {
      return decode(bytes, utf16);
    } catch {
      // 无 BOM 的判断仅为启发式，失败后回到标准回退流程。
    }
  }
  for (const encoding of ['utf-8', 'gb18030', 'big5'] as const) {
    try {
      return decode(bytes, encoding);
    } catch {
      // 严格解码失败才尝试下一候选，禁止用替换字符静默吞掉坏字节。
    }
  }
  throw new TextDecodingError(
    t('无法识别文本编码，文件可能损坏，请转换为 UTF-8 后重试。'),
  );
}
import { t } from '@/i18n';
