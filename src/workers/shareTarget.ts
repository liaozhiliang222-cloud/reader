import { incomingData, incomingLimit } from '../app/incomingData';
import { createIncomingStore } from '../db/incoming';

export function isShareTarget(request: Request, scope: string) {
  const target = new URL('share-target', scope),
    url = new URL(request.url);
  return (
    request.method === 'POST' &&
    url.origin === target.origin &&
    url.pathname === target.pathname
  );
}
export async function receiveShare(
  request: Request,
  scope: string,
  store?: ReturnType<typeof createIncomingStore>,
) {
  const location = new URL('./', scope);
  try {
    const data = incomingData(await readSharedForm(request));
    const id = crypto.randomUUID();
    await (store ?? createIncomingStore(scope)).put(id, data);
    location.hash = '#/incoming/' + id;
  } catch (cause) {
    location.hash =
      '#/incoming/error-' +
      (cause instanceof RangeError
        ? 'size'
        : cause instanceof TypeError
          ? 'format'
          : 'storage');
  }
  return Response.redirect(location.href, 303);
}
export async function readSharedForm(
  request: Request,
  limit = incomingLimit + 1024 * 1024,
) {
  if (
    !request.headers
      .get('Content-Type')
      ?.toLowerCase()
      .startsWith('multipart/form-data') ||
    !request.body
  )
    throw new TypeError('分享格式无效。');
  if (Number(request.headers.get('Content-Length')) > limit)
    throw new RangeError('分享内容过大。');
  let size = 0;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) throw new RangeError('分享内容过大。');
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { headers: request.headers }).formData();
}
