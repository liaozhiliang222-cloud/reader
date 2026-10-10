import type { IncomingData } from './incomingData';
import { incomingStore, incomingChanged } from './incoming';
import {
  importBatch,
  type ImportItem,
  type ImportResult,
} from '@/parsers/batch';
import { importText } from '@/parsers/importText';
interface Store {
  get(id: string): Promise<IncomingData>;
  put(id: string, data: IncomingData): Promise<void>;
  remove(id: string): Promise<void>;
}
export function createIncomingJobs(
  store: () => Store,
  parse: (file: File) => Promise<ImportResult>,
  changed: () => void,
) {
  const tasks = new Map<
    string,
    {
      promise: Promise<{ items: ImportItem[]; data: IncomingData }>;
      listeners: Set<(items: ImportItem[]) => void>;
    }
  >();
  return (id: string, update: (items: ImportItem[]) => void) => {
    let task = tasks.get(id);
    if (!task) {
      const listeners = new Set<(items: ImportItem[]) => void>();
      const promise = (async () => {
        const storage = store(),
          payload = await storage.get(id);
        const items = await importBatch(payload.files, parse, (value) => {
          for (const listener of listeners) listener(value);
        });
        const data = {
          ...payload,
          files: payload.files.filter(
            (_, index) => items[index]?.status === 'error',
          ),
        };
        if (data.files.length || data.text || data.errors.length)
          await storage.put(id, data);
        else await storage.remove(id);
        changed();
        return { items, data };
      })().finally(() => tasks.delete(id));
      task = { promise, listeners };
      tasks.set(id, task);
    }
    task.listeners.add(update);
    return {
      promise: task.promise,
      release: () => task.listeners.delete(update),
    };
  };
}
export const processIncoming = createIncomingJobs(
  incomingStore,
  importText,
  incomingChanged,
);
