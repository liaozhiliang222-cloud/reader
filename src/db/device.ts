import { db } from './index';
/** Device-local identity is excluded from backups and regenerated after clearing data. */
export async function deviceId(database = db) {
  return database.transaction('rw', database.localMeta, async () => {
    const existing = await database.localMeta.get('deviceId');
    if (existing) return existing.value;
    const value = crypto.randomUUID();
    await database.localMeta.put({ id: 'deviceId', value });
    return value;
  });
}
