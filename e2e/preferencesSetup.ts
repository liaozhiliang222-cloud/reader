import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default async function setup() {
  const runId = randomUUID();
  const reports = resolve('artifacts/preferences-browser', runId);
  await mkdir(reports, { recursive: true });
  process.env.JINGYE_PREFERENCES_RUN = runId;
  await writeFile(
    'artifacts/preferences-run.json',
    JSON.stringify(
      { runId, reports, startedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
}
