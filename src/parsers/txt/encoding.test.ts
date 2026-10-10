import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeText, TextDecodingError } from './encoding';

function fixture(name: string): ArrayBuffer {
  const data = readFileSync(new URL(`./fixtures/${name}.bin`, import.meta.url));
  return Uint8Array.from(data).buffer;
}
function expected(name: string) {
  return readFileSync(
    new URL(`./fixtures/${name}.expected.txt`, import.meta.url),
    'utf8',
  );
}

describe('TXT 编码识别', () => {
  it.each([
    ['utf8', 'utf-8'],
    ['utf8-bom', 'utf-8'],
    ['gbk', 'gb18030'],
    ['gb18030', 'gb18030'],
    ['utf16-le', 'utf-16le'],
    ['utf16-be', 'utf-16be'],
    ['utf16-le-no-bom', 'utf-16le'],
    ['utf16-be-no-bom', 'utf-16be'],
  ])('解码 %s，保留正文和换行', (name, encoding) => {
    expect(decodeText(fixture(name!))).toEqual({
      text: expected(name!),
      encoding,
    });
  });

  it('GBK 合成网文前 200 字及全部正文与原稿一致', () => {
    const result = decodeText(fixture('gbk'));
    expect(result.text.length).toBeGreaterThan(200);
    expect(result.text.slice(0, 200)).toBe(expected('gbk').slice(0, 200));
    expect(result.text).not.toContain('\ufffd');
  });

  it('空文件与 ASCII 默认 UTF-8', () => {
    expect(decodeText(new ArrayBuffer(0))).toEqual({
      text: '',
      encoding: 'utf-8',
    });
    expect(
      decodeText(new TextEncoder().encode('Chapter 1\nHello').buffer),
    ).toEqual({
      text: 'Chapter 1\nHello',
      encoding: 'utf-8',
    });
  });

  it('明确记录 Big5 与 GB18030 字节重叠时采用产品优先级', () => {
    const data = fixture('big5-ambiguous');
    expect(new TextDecoder('big5', { fatal: true }).decode(data)).toBe(
      expected('big5-ambiguous'),
    );
    expect(decodeText(data).encoding).toBe('gb18030');
    expect(decodeText(data).text).not.toBe(expected('big5-ambiguous'));
  });

  it.each([
    [0xef, 0xbb, 0xbf, 0xc3],
    [0xff, 0xfe, 0x41],
    [0xfe, 0xff, 0xd8, 0],
    [0x81],
    [0xff, 0xfe, 0, 0, 0x41, 0, 0, 0],
    [0, 0, 0xfe, 0xff, 0, 0, 0, 0x41],
  ])('拒绝损坏或不支持的字节 %j', (...bytes) => {
    expect(() => decodeText(Uint8Array.from(bytes).buffer)).toThrow(
      TextDecodingError,
    );
  });

  it('只去除开头 BOM，保留正文内部的 BOM 字符', () => {
    const text = '甲\ufeff乙';
    expect(
      decodeText(new TextEncoder().encode('\ufeff' + text).buffer).text,
    ).toBe(text);
  });
});
