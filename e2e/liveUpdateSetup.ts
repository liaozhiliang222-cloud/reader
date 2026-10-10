import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default async function setup() {
  const previous = JSON.parse(
    await readFile('artifacts/deployment-http.json', 'utf8'),
  ) as { url: string; preparedAt: string; resources: { path: string }[] };
  const next = JSON.parse(
    await readFile('artifacts/deployment-build.json', 'utf8'),
  ) as { preparedAt: string; files: { path: string; sha256: string }[] };
  const oldMain = previous.resources.find((file) =>
    /^assets\/index-.*\.js$/.test(file.path),
  )?.path;
  const newMain = next.files.find((file) =>
    /^assets\/index-.*\.js$/.test(file.path),
  );
  if (
    !oldMain ||
    !newMain ||
    oldMain === newMain.path ||
    previous.preparedAt === next.preparedAt
  )
    throw new Error(
      'Live update requires the verified old deployment and a different prepared build; start before uploading.',
    );
  const runId = randomUUID(),
    reports = resolve('.e2e-live-update', runId);
  await mkdir(reports, { recursive: true });
  process.env.JINGYE_LIVE_UPDATE_RUN = reports;
  await writeFile(
    'artifacts/deployment-update-run.json',
    JSON.stringify(
      {
        runId,
        reports,
        startedAt: new Date().toISOString(),
        origin: new URL(previous.url).origin,
        previousPreparedAt: previous.preparedAt,
        preparedAt: next.preparedAt,
        oldMain: '/' + oldMain,
        newMain: '/' + newMain.path,
        newMainSha256: newMain.sha256,
      },
      null,
      2,
    ) + '\n',
  );
}
