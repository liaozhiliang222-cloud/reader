import { BoundedZip } from './zip';
const limits = {
  input: 50 * 1024 * 1024,
  entries: 512,
  entry: 50 * 1024 * 1024,
  total: 100 * 1024 * 1024,
};
export async function archiveList(source: Blob) {
  const zip = await BoundedZip.load(source, limits);
  if (zip.has('META-INF/container.xml') || zip.has('mimetype'))
    throw new Error('这是 EPUB 容器，请使用 .epub 扩展名导入。');
  return zip
    .paths()
    .filter(
      (path) =>
        /\.(txt|epub|md|markdown)$/i.test(path) &&
        !path.startsWith('__MACOSX/'),
    )
    .map((path) => ({ path, size: zip.size(path)! }));
}
export async function archiveRead(source: Blob, path: string) {
  if (!(await archiveList(source)).some((entry) => entry.path === path))
    throw new Error('请选择压缩包内支持的书籍，暂不递归解包。');
  return (await BoundedZip.load(source, limits)).read(path);
}
