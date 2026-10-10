import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { build } from 'vite';

export interface UpdateBuild {
  directory: string;
  version: string;
  main: string;
  worker: string;
  serviceWorkerSha256: string;
}
export interface UpdateManifest {
  a: UpdateBuild;
  b: UpdateBuild;
  reports: string;
}
export default async function setup() {
  const root = resolve('.'),
    working = resolve('.e2e-update', randomUUID()),
    source = join(working, 'source');
  await mkdir(source, { recursive: true });
  // Only source/public inputs, never books, browser profiles or the Git directory.
  for (const name of [
    'src',
    'public',
    'index.html',
    'vite.config.ts',
    'package.json',
    'scripts/security-policy.ts',
  ])
    await cp(resolve(root, name), join(source, name), { recursive: true });
  await symlink(
    resolve(root, 'node_modules'),
    join(source, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const packagePath = join(source, 'package.json');
  const packageInfo: unknown = JSON.parse(await readFile(packagePath, 'utf8'));
  if (
    !packageInfo ||
    typeof packageInfo !== 'object' ||
    !('version' in packageInfo) ||
    typeof packageInfo.version !== 'string'
  )
    throw new Error('Invalid project version');
  const originalVersion = packageInfo.version;
  const create = async (suffix: 'a' | 'b'): Promise<UpdateBuild> => {
    packageInfo.version = `${originalVersion}-e2e-${suffix}`;
    await writeFile(packagePath, JSON.stringify(packageInfo, null, 2) + '\n');
    const directory = join(working, suffix);
    await build({
      root: source,
      configFile: join(source, 'vite.config.ts'),
      logLevel: 'warn',
      build: { outDir: directory, emptyOutDir: false },
    });
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    const main = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    const sw = await readFile(join(directory, 'sw.js'));
    const worker = sw
      .toString()
      .match(/assets\/parse\.worker-[^"'`\s]+\.js/)?.[0];
    if (!main || !worker)
      throw new Error('Update build lacks main or parser Worker');
    return {
      directory,
      version: packageInfo.version as string,
      main,
      worker: '/' + worker,
      serviceWorkerSha256: createHash('sha256').update(sw).digest('hex'),
    };
  };
  const a = await create('a'),
    b = await create('b');
  if (a.main === b.main || a.serviceWorkerSha256 === b.serviceWorkerSha256)
    throw new Error(
      'Two update builds must have different main chunks and real SW bytes',
    );
  const reports = join(working, 'reports');
  await mkdir(reports);
  await writeFile(
    resolve('.e2e-update/manifest.json'),
    JSON.stringify({ a, b, reports } satisfies UpdateManifest, null, 2) + '\n',
  );
}
