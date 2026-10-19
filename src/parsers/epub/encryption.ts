import { t } from '@/i18n';
import { elements, parseXml, resolvePath, type XmlElement } from './xml';

/** 阅读器使用自己的字体；合法字体混淆只需忽略，不解密或使用包内字体。 */
export function obfuscatedFonts(source: string) {
  const doc = parseXml(source),
    records = elements(doc, 'encrypteddata');
  if (elements(doc, 'encryptedkey').length)
    throw new Error(t('该书受版权保护，暂不支持。'));
  if (!records.length)
    throw new Error(t('书籍加密信息不完整，无法确认是否可读取。'));
  return records.map((record) => {
    const methods = elements(record, 'encryptionmethod'),
      references = elements(record, 'cipherreference');
    if (
      methods.length !== 1 ||
      references.length !== 1 ||
      methods[0]!.getAttribute('Algorithm') !==
        'http://www.idpf.org/2008/embedding'
    )
      throw new Error(t('该书受版权保护或使用不支持的加密方式，暂不支持。'));
    const uri = references[0]!.getAttribute('URI') ?? '';
    if (!uri || uri.includes('#')) throw new Error(t('字体混淆资源路径无效。'));
    return resolvePath('', uri).path;
  });
}
export function validateObfuscatedFonts(
  paths: string[],
  manifest: Iterable<XmlElement>,
  opfPath: string,
  spine: string[],
  exists: (path: string) => boolean,
) {
  const fonts = new Set(
    Array.from(manifest)
      .filter(
        (item) =>
          /^(?:font\/(?:otf|ttf|woff|woff2)|application\/(?:font-sfnt|font-woff|vnd\.ms-opentype))$/.test(
            item.getAttribute('media-type') ?? '',
          ) &&
          !(item.getAttribute('properties') ?? '').split(/\s+/).includes('nav'),
      )
      .map(
        (item) => resolvePath(opfPath, item.getAttribute('href') ?? '').path,
      ),
  );
  for (const path of paths)
    if (
      !fonts.has(path) ||
      spine.includes(path) ||
      path === opfPath ||
      !exists(path)
    )
      throw new Error(t('字体混淆信息指向了非字体或缺失资源，无法读取。'));
}
