import {
  incomingData,
  incomingForm,
  validIncomingId,
  type IncomingData,
} from '@/app/incomingData';

export function incomingKeys(scope: string) {
  const prefix =
    'incoming:' + encodeURIComponent(new URL(scope).pathname) + ':';
  return {
    prefix,
    key(id: string) {
      if (!validIncomingId(id)) throw new Error('分享标识无效。');
      return prefix + id;
    },
    list(keys: IDBValidKey[]) {
      return keys
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.slice(prefix.length))
        .filter(validIncomingId);
    },
  };
}
export async function encodeIncoming(id: string, data: IncomingData) {
  const validated = incomingData(incomingForm(data));
  // WKWebView 的 multipart 序列化对非 ASCII 文件名产出 filename*= 编码，
  // 而其解析器不能读回，文件项退化为字符串——改用 ASCII 占位名，真名存 value.names。
  const form = new FormData();
  validated.files.forEach((file, index) =>
    form.append('files', file, 'file-' + index),
  );
  const response = new Response(form);
  return {
    id,
    type: response.headers.get('Content-Type')!,
    data: await response.blob(),
    value: {
      title: validated.title,
      text: validated.text,
      errors: validated.errors,
      names: validated.files.map((file) => file.name),
    },
  };
}
export async function decodeIncoming(record: unknown): Promise<IncomingData> {
  if (
    !record ||
    typeof record !== 'object' ||
    !('data' in record) ||
    !(record.data instanceof Blob) ||
    !('type' in record) ||
    typeof record.type !== 'string' ||
    !record.type.startsWith('multipart/form-data;')
  )
    throw new Error('这份分享已处理或不在本机，请重新分享。');
  const form = await new Response(record.data, {
    headers: { 'Content-Type': record.type },
  }).formData();
  if ('value' in record) {
    const value = record.value;
    if (
      !value ||
      typeof value !== 'object' ||
      !('text' in value) ||
      typeof value.text !== 'string' ||
      !('title' in value) ||
      typeof value.title !== 'string' ||
      !('errors' in value) ||
      !Array.isArray(value.errors) ||
      !value.errors.every((item: unknown) => typeof item === 'string')
    )
      throw new Error('分享暂存已损坏，请重新分享。');
    form.set('text', value.text);
    form.set('title', value.title);
    for (const error of value.errors) form.append('error', error);
  }
  const parsed = incomingData(form);
  // 恢复占位文件名；旧记录没有 names 时用解析出的原名（ASCII 名本就能往返）。
  const names =
    'value' in record &&
    record.value &&
    typeof record.value === 'object' &&
    'names' in record.value
      ? (record.value as { names?: unknown }).names
      : undefined;
  if (
    names !== undefined &&
    (!Array.isArray(names) ||
      names.length !== parsed.files.length ||
      !names.every(
        (name) =>
          typeof name === 'string' && name.length > 0 && name.length <= 255,
      ))
  )
    throw new Error('分享文件名暂存已损坏，请重新分享。');
  if (Array.isArray(names))
    parsed.files = parsed.files.map((file, index) =>
      typeof names[index] === 'string' && names[index]
        ? new File([file], names[index], {
            type: file.type,
            lastModified: file.lastModified,
          })
        : file,
    );
  return incomingData(incomingForm(parsed));
}
