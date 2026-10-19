import type { IncomingData } from '@/app/incomingData';
import { incomingKeys, encodeIncoming, decodeIncoming } from './incomingRecord';

/** Native IDB uses the existing blobs store; no schema change or Dexie in the SW. */
export function createIncomingStore(
  scope: string,
  factory: IDBFactory = indexedDB,
  databaseName = 'jingye',
) {
  const { prefix, key, list } = incomingKeys(scope);
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error('本地存储暂时被占用，请重新打开微光阅读。'));
      }, 10_000);
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onerror = () => {
        clearTimeout(timer);
        reject(new Error('请先打开微光阅读初始化本地存储，再重新分享。'));
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (expired) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  const run = async <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction('blobs', mode);
        let result: T;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error('分享暂存失败，请检查本地存储。'),
          );
        const request = operation(transaction.objectStore('blobs'));
        request.onsuccess = () => {
          result = request.result;
        };
      });
    } finally {
      database.close();
    }
  };
  return {
    async put(id: string, data: IncomingData) {
      const record = await encodeIncoming(key(id), data);
      await run('readwrite', (store) => store.put(record));
    },
    async get(id: string): Promise<IncomingData> {
      const record = await run<unknown>('readonly', (store) =>
        store.get(key(id)),
      );
      return decodeIncoming(record);
    },
    async remove(id: string) {
      await run('readwrite', (store) => store.delete(key(id)));
    },
    async list() {
      const keys = await run<IDBValidKey[]>('readonly', (store) =>
        store.getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff')),
      );
      return list(keys);
    },
  };
}
