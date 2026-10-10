import { BoundedZip } from './zip';
import { decodeText } from './txt/encoding';
import { parseMarkdown } from './markdown';
import { sanitizeSvg } from './epub/svg';

/** One Markdown document plus local images; original ZIP is retained verbatim. */
export async function parseMarkdownPackage(
  buffer: ArrayBuffer,
  id: string,
  encoding?: string,
) {
  const zip = await BoundedZip.load(buffer, {
    input: 50 * 1024 * 1024,
    entries: 512,
    entry: 10 * 1024 * 1024,
    total: 60 * 1024 * 1024,
  });
  const paths = zip.paths();
  const documents = paths.filter(
    (path) => /\.(md|markdown)$/i.test(path) && !path.startsWith('__MACOSX/'),
  );
  if (documents.length !== 1)
    throw new Error(
      'Markdown 图文包需要且只能包含一个 .md 或 .markdown 文档。',
    );
  const path = documents[0]!;
  const original = await (await zip.read(path)).arrayBuffer();
  const decoded = encoding
    ? {
        text: new TextDecoder(encoding, { fatal: true }).decode(original),
        encoding,
      }
    : decodeText(original);
  const images = new Map<string, string>();
  const assets: { id: string; data: Blob }[] = [];
  for (const path of paths) {
    const extension = /\.(png|jpe?g|gif|webp|svg)$/i
      .exec(path)?.[1]
      ?.toLowerCase();
    if (!extension || path.startsWith('__MACOSX/')) continue;
    if (assets.length >= 256)
      throw new Error('图片超过 256 张，请拆分图文包。');
    const bytes = new Uint8Array(await (await zip.read(path)).arrayBuffer());
    let type: string, data: ArrayBuffer | string;
    if (extension === 'svg') {
      const svg =
        bytes.length <= 1024 * 1024
          ? sanitizeSvg(new TextDecoder().decode(bytes))
          : undefined;
      if (!svg) continue;
      type = 'image/svg+xml';
      data = svg;
    } else {
      const valid =
        extension === 'png'
          ? bytes.slice(0, 8).join() === '137,80,78,71,13,10,26,10'
          : /^jpe?g$/.test(extension)
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : extension === 'gif'
              ? /^GIF8[79]a/.test(new TextDecoder().decode(bytes.slice(0, 6)))
              : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
                new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
      if (!valid) throw new Error('图片格式与文件内容不符：' + path);
      type = 'image/' + (/^jpe?g$/.test(extension) ? 'jpeg' : extension);
      data = Uint8Array.from(bytes).buffer;
    }
    const assetId = `${id}:image:${assets.length}`;
    images.set(path, assetId);
    assets.push({ id: assetId, data: new Blob([data], { type }) });
  }
  const parsed = parseMarkdown(decoded.text, 2, images, path);
  await zip.verifyRemaining();
  return { ...parsed, encoding: decoded.encoding, assets };
}
