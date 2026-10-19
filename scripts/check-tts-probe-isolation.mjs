import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import JSZip from 'jszip';

const apk = resolve(
  process.argv[2] ?? 'android/app/build/outputs/apk/release/app-release.apk',
);
const sdkTools = process.argv[3] ?? 'D:/Android/Sdk/build-tools/36.0.0';
const output = resolve('artifacts/tts-probe/release-isolation');
await mkdir(output, { recursive: true });
const bytes = await readFile(apk);
const zip = await JSZip.loadAsync(bytes);
const forbidden =
  /dev[./]jingye[./]ttsprobe|ProbeActivity|ProbeService|ProbeWebActivity|TtsPrepareProbe|JyProbe|SpeechAcceptanceTest|native-original-fixture|__speechBackendDouble|browser-test-double/;
const manifest = execFileSync(
  resolve(sdkTools, 'aapt.exe'),
  ['dump', 'xmltree', apk, 'AndroidManifest.xml'],
  { encoding: 'utf8' },
);
const permissions = execFileSync(
  resolve(sdkTools, 'aapt.exe'),
  ['dump', 'permissions', apk],
  { encoding: 'utf8' },
);
if (
  forbidden.test(manifest) ||
  permissions.includes('android.permission.INTERNET')
)
  throw new Error('Release manifest contains a probe or INTERNET permission.');
const dexFiles = Object.values(zip.files).filter((file) =>
  /^classes\d*\.dex$/.test(file.name),
);
if (!dexFiles.length) throw new Error('No DEX inspected.');
for (const file of dexFiles) {
  const path = resolve(output, basename(file.name));
  await writeFile(path, await file.async('nodebuffer'));
  const dump = execFileSync(resolve(sdkTools, 'dexdump.exe'), [path], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (forbidden.test(dump))
    throw new Error('Probe symbols present in release DEX.');
}
for (const file of Object.values(zip.files)) {
  if (forbidden.test(file.name)) throw new Error('Probe asset in release APK.');
  if (
    /\.(js|html|json)$/.test(file.name) &&
    forbidden.test(await file.async('string'))
  )
    throw new Error('Probe code present in release web assets.');
}
const report = {
  apk,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  dexFiles: dexFiles.map((file) => file.name),
  manifestChecked: true,
  webAssetsChecked: true,
  probeAbsent: true,
  internetAbsent: true,
  measuredAt: new Date().toISOString(),
};
await writeFile(
  resolve(output, 'report.json'),
  JSON.stringify(report, null, 2),
);
await writeFile(resolve(output, 'permissions.txt'), permissions);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
