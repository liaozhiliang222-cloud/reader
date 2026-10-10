import { decodeText } from './txt/encoding';
import { splitChapters } from './txt/chapters';
import { parseEpub } from './epub/parse';
import { EPUB_PARSER_VERSION, type EpubParserVersion } from './epub/version';
import { parseMarkdown } from './markdown';
import { bookIdForHash, sourceHash } from './identity';
import { parseMarkdownPackage } from './markdownPackage';
export async function parseText(buffer: ArrayBuffer, encoding?: string) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const id = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const decoded =
    encoding === undefined
      ? decodeText(buffer)
      : {
          encoding,
          text: new TextDecoder(encoding, { fatal: true }).decode(buffer),
        };
  const chapters = splitChapters(decoded.text);
  if (!chapters.length) throw new Error('文件没有可阅读的内容。');
  return {
    id,
    encoding: decoded.encoding,
    chapters,
    charCount: chapters.reduce((n, c) => n + c.charCount, 0),
  };
}
export async function parseFile(
  buffer: ArrayBuffer,
  type: 'txt' | 'epub' | 'md',
  encoding?: string,
  epubVersion: EpubParserVersion = EPUB_PARSER_VERSION,
  markdownVersion = 2,
) {
  if (type === 'md') {
    const id = bookIdForHash({ type }, await sourceHash(buffer));
    if (
      new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)).join() ===
      '80,75,3,4'
    ) {
      if (markdownVersion !== 2)
        throw new Error('Markdown 图文包需要第二版解析器。');
      return {
        ...(await parseMarkdownPackage(buffer, id, encoding)),
        id,
        author: undefined,
        coverBlobId: undefined,
        parserVersion: undefined,
      };
    }
    const decoded = encoding
      ? {
          text: new TextDecoder(encoding, { fatal: true }).decode(buffer),
          encoding,
        }
      : decodeText(buffer);
    return {
      ...parseMarkdown(decoded.text, markdownVersion),
      id,
      encoding: decoded.encoding,
      author: undefined,
      coverBlobId: undefined,
      assets: [],
      parserVersion: undefined,
    };
  }
  if (type === 'txt')
    return {
      ...(await parseText(buffer, encoding)),
      title: undefined,
      author: undefined,
      coverBlobId: undefined,
      toc: undefined,
      assets: [],
      parserVersion: undefined,
      markdownVersion: undefined,
    };
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const id = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return {
    ...(await parseEpub(buffer, id, epubVersion)),
    id,
    encoding: undefined,
    markdownVersion: undefined,
  };
}
