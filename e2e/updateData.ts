import type { Page } from '@playwright/test';

// Read-only native IDB snapshot. Compare all seven tables, hashing real Blob bytes.
export async function updateData(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((accept, reject) => {
      const request = indexedDB.open('jingye');
      request.onsuccess = () => accept(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = [
        'books',
        'chapters',
        'progress',
        'bookmarks',
        'highlights',
        'settings',
        'blobs',
      ];
      const transaction = db.transaction(names, 'readonly');
      const rows = await Promise.all(
        names.map(
          (name) =>
            new Promise<{ name: string; records: unknown[] }>(
              (accept, reject) => {
                const request = transaction.objectStore(name).getAll();
                request.onsuccess = () =>
                  accept({ name, records: request.result as unknown[] });
                request.onerror = () => reject(request.error);
              },
            ),
        ),
      );
      const data: Record<string, unknown[]> = {};
      for (const { name, records } of rows) {
        data[name] =
          name === 'blobs'
            ? await Promise.all(
                records.map(async (row) => {
                  if (
                    !row ||
                    typeof row !== 'object' ||
                    !('id' in row) ||
                    !('data' in row) ||
                    !(row.data instanceof Blob)
                  )
                    throw new Error('Invalid original Blob record');
                  const sha256 = [
                    ...new Uint8Array(
                      await crypto.subtle.digest(
                        'SHA-256',
                        await row.data.arrayBuffer(),
                      ),
                    ),
                  ]
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('');
                  return {
                    id: row.id,
                    size: row.data.size,
                    type: row.data.type,
                    sha256,
                  };
                }),
              )
            : records;
      }
      return data;
    } finally {
      db.close();
    }
  });
}
