import { t } from '@/i18n';
export const incomingLimit = 100 * 1024 * 1024;
export const validIncomingId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
export interface IncomingData {
  files: File[];
  title: string;
  text: string;
  errors: string[];
}
const field = (form: FormData, name: string) => {
  const value = form.get(name);
  if (value !== null && typeof value !== 'string')
    throw new TypeError(t('分享文字格式无效。'));
  return value ?? '';
};
export function incomingData(form: FormData): IncomingData {
  const files = form.getAll('files').map((value) => {
    if (typeof value === 'string') throw new TypeError(t('分享文件格式无效。'));
    let name =
      value.name
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/[\p{Cc}]/gu, '_') || t('分享文件');
    if (!name.includes('.')) {
      const mime = value.type.split(';')[0]?.trim();
      if (mime === 'application/epub+zip') name += '.epub';
      else if (mime === 'application/pdf') name += '.pdf';
      else if (mime === 'text/plain') name += '.txt';
      else if (mime === 'text/markdown' || mime === 'text/x-markdown')
        name += '.md';
    }
    return new File([value], name.slice(0, 255), {
      type: value.type,
      lastModified: value.lastModified,
    });
  });
  const title = field(form, 'title').slice(0, 200);
  const body = field(form, 'text'),
    url = field(form, 'url');
  const text = body
    ? body + (url && !body.includes(url) ? '\n\n' + url : '')
    : url || (!files.length ? title : '');
  const errors = form.getAll('error').map((value) => {
    if (typeof value !== 'string') throw new TypeError(t('分享错误信息无效。'));
    return value.slice(0, 300);
  });
  if (
    new Blob([text]).size > 50 * 1024 * 1024 ||
    files.reduce((sum, file) => sum + file.size, 0) + new Blob([text]).size >
      incomingLimit
  )
    throw new RangeError(
      t('这次分享内容超过 100 MB，或文字超过 50 MB，请分批导入。'),
    );
  if (!files.length && !text.trim() && !errors.length)
    throw new TypeError(t('没有收到文件或文字，请重新分享。'));
  return { files, text, title: text ? title : '', errors };
}
export function incomingForm(data: IncomingData) {
  const form = new FormData();
  for (const file of data.files) form.append('files', file, file.name);
  form.set('text', data.text);
  form.set('title', data.title);
  for (const error of data.errors) form.append('error', error);
  return form;
}
