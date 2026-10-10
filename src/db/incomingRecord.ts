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
  const response = new Response(
    incomingForm({ ...validated, title: '', text: '', errors: [] }),
  );
  return {
    id,
    type: response.headers.get('Content-Type')!,
    data: await response.blob(),
    value: {
      title: validated.title,
      text: validated.text,
      errors: validated.errors,
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
  return incomingData(form);
}
