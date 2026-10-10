import { db } from './index';
import { incomingKeys, encodeIncoming, decodeIncoming } from './incomingRecord';
import type { IncomingData } from '@/app/incomingData';

/** Main page reuses Dexie; the SW continues to use the native adapter. */
export function createIncomingClient(scope: string, database = db) {
  const { prefix, key, list } = incomingKeys(scope);
  return {
    async put(id: string, data: IncomingData) {
      const record = await encodeIncoming(key(id), data);
      await database.transaction('rw', database.blobs, () =>
        database.blobs.put(record),
      );
    },
    async get(id: string) {
      return decodeIncoming(await database.blobs.get(key(id)));
    },
    async remove(id: string) {
      await database.blobs.delete(key(id));
    },
    async list() {
      return list(
        await database.blobs
          .where(':id')
          .between(prefix, prefix + '\uffff', true, true)
          .primaryKeys(),
      );
    },
  };
}
