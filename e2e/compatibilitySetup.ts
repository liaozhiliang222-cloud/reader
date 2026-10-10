import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export default async function setup() {
  const runId = randomUUID(),
    reports = resolve('.e2e-compat', runId);
  const sourceBytes = await readFile('scripts/real-epub-sources.json');
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const sources = JSON.parse(sourceBytes.toString()) as { id: string }[];
  const availability = await Promise.all(
    sources.map(async ({ id }) => {
      const file = resolve('test-books/real-epubs', `${id}.epub`);
      if (!existsSync(file)) return { id, file, available: false };
      const bytes = await readFile(file);
      return {
        id,
        file,
        available: true,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
  await mkdir(reports, { recursive: true });
  process.env.JINGYE_COMPAT_RUN = reports;
  await writeFile(
    'artifacts/compatibility-run.json',
    JSON.stringify(
      {
        runId,
        reports,
        startedAt: new Date().toISOString(),
        sourceSha256,
        sources,
        availability,
        productionIndexSha256: createHash('sha256')
          .update(await readFile('dist/index.html'))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
}
