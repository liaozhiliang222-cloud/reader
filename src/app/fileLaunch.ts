import { incomingData } from './incomingData';
import type { IncomingData } from './incomingData';

interface FileHandle {
  name?: string;
  getFile(): Promise<File>;
}
interface LaunchParams {
  files?: readonly FileHandle[];
}
export interface LaunchHost {
  launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
}

/** Serial launches keep a later payload from replacing a currently importing one. */
export function installFileConsumer(
  host: LaunchHost,
  deliver: (data: IncomingData) => Promise<void>,
  fail: () => void,
) {
  if (!host.launchQueue?.setConsumer) return;
  let queue = Promise.resolve();
  host.launchQueue.setConsumer((params) => {
    if (!params.files?.length) return;
    queue = queue
      .then(async () => {
        const form = new FormData();
        for (const handle of params.files ?? []) {
          try {
            const file = await handle.getFile();
            form.append('files', file, file.name);
          } catch {
            form.append(
              'error',
              `${handle.name ?? '文件'}：未能读取，请重新选择。`,
            );
          }
        }
        await deliver(incomingData(form));
      })
      .catch(fail);
  });
  return () => queue;
}
