import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default async function setup() {
  const runId = randomUUID(),
    reports = resolve('.e2e-interactions', runId);
  await mkdir(reports, { recursive: true });
  process.env.JINGYE_INTERACTIONS_RUN = reports;
  const sources = await Promise.all(
    [
      'e2e/interactions.spec.ts',
      'e2e/interactionProbe.ts',
      'e2e/helpers.ts',
      'src/pages/Reader/ReaderView.tsx',
      'src/reader/PageMotion.ts',
      'src/styles/motion.css',
    ].map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    })),
  );
  await writeFile(
    'artifacts/interactions-run.json',
    JSON.stringify(
      {
        runId,
        reports,
        startedAt: new Date().toISOString(),
        sources,
        productionIndexSha256: createHash('sha256')
          .update(await readFile('dist/index.html'))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
}
