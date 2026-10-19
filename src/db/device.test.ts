import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createDatabase } from './schema';
import { deviceId } from './device';
import { createSnapshot } from '@/backup/snapshot';
it('本机身份在新数据库中持久生成，备份不带入另一设备', async () => {
  const database = createDatabase('device-' + crypto.randomUUID());
  try {
    const first = await deviceId(database);
    expect(await deviceId(database)).toBe(first);
    expect(
      JSON.stringify((await createSnapshot('light', database)).backup),
    ).not.toContain(first);
  } finally {
    await database.delete();
  }
});
