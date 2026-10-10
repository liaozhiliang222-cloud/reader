import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = JSON.parse(await readFile('package.json', 'utf8'));
const visited = new Set(),
  notices = [];
async function visit(name, parent) {
  const require = createRequire(parent);
  let entry;
  try {
    entry = require.resolve(name + '/package.json');
  } catch {
    try {
      entry = require.resolve(name);
    } catch {
      for (const path of require.resolve.paths(name) ?? []) {
        try {
          entry = await realpath(join(path, name, 'package.json'));
          break;
        } catch {
          /* ESM-only and declaration packages may have no require export. */
        }
      }
      if (!entry) throw new Error(`Package not found: ${name}`);
    }
  }
  let dir = dirname(await realpath(entry));
  let pkg;
  for (;;) {
    try {
      pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    } catch {
      pkg = undefined;
    }
    if (pkg?.name === name) break;
    if (dirname(dir) === dir) throw new Error(`Package not found: ${name}`);
    dir = dirname(dir);
  }
  const key = `${name}@${pkg.version}`;
  if (visited.has(key)) return;
  visited.add(key);
  const files = (await readdir(dir))
    .filter((file) =>
      /^(licen[cs]e|copying|copyright|notice)([._-].*)?$/i.test(file),
    )
    .sort();
  if (!files.length) {
    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    const licenseSection = readme.match(/^##? License\s*\n([\s\S]*)/im)?.[1];
    if (!licenseSection || !/Copyright/i.test(licenseSection))
      throw new Error(`License text missing: ${key}`);
    notices.push({ key, license: pkg.license, text: licenseSection.trim() });
  } else {
    notices.push({
      key,
      license: pkg.license,
      text: (
        await Promise.all(
          files.map((file) => readFile(join(dir, file), 'utf8')),
        )
      ).join('\n\n'),
    });
  }
  if (name === 'pako') {
    let source;
    if (pkg.version.startsWith('1.'))
      source = await readFile(join(dir, 'lib/zlib/inflate.js'), 'utf8');
    else {
      const map = JSON.parse(
        await readFile(join(dir, 'dist/pako.mjs.map'), 'utf8'),
      );
      const index = map.sources.findIndex((path) =>
        path.endsWith('/zlib/inflate.mjs'),
      );
      source = map.sourcesContent[index];
    }
    const notice = source?.match(/(?:^\/\/[^\n]*(?:\r?\n|$))+/m)?.[0];
    if (!notice?.includes('This notice may not be removed'))
      throw new Error(`Zlib copyright notice missing: ${key}`);
    notices.at(-1).text +=
      '\n\nZlib component notice (unaltered upstream text):\n' +
      notice.replace(/^\/\/ ?/gm, '').trim();
  }
  for (const child of Object.keys(pkg.dependencies ?? {}).sort())
    await visit(child, join(dir, 'package.json'));
}
for (const name of Object.keys(root.dependencies).sort())
  await visit(name, new URL('../package.json', import.meta.url));
// Capacitor Android 位于 devDependencies，但它的原生代码会随 APK 交付。
if (root.devDependencies?.['@capacitor/android'])
  await visit(
    '@capacitor/android',
    new URL('../package.json', import.meta.url),
  );
notices.sort((a, b) => a.key.localeCompare(b.key));
await writeFile(
  'public/licenses.txt',
  '静页第三方运行组件许可\n\nJSZip 按 MIT 分支使用；下方保留各组件的完整版权与许可文本。\n字体许可另见 fonts/OFL.txt。开发工具不进入浏览器交付包。\n\n' +
    notices
      .map(
        (item) =>
          `${'='.repeat(60)}\n${item.key} — ${item.license}\n${'='.repeat(60)}\n${item.text}`,
      )
      .join('\n\n'),
);
console.log(notices.map(({ key, license }) => ({ key, license })));
