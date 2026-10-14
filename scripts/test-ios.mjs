import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.platform !== 'darwin')
  throw new Error(
    'Xcode and XCTest require macOS. pnpm build:ios on Windows only prepares web assets.',
  );
const inventory = JSON.parse(
  execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
    encoding: 'utf8',
  }),
);
const phones = Object.values(inventory.devices)
  .flat()
  .filter((device) => device.isAvailable && device.name.startsWith('iPhone'));
const device = phones.find((device) => device.state === 'Booted') ?? phones[0];
if (!device)
  throw new Error('Install an iOS Simulator runtime in Xcode Settings first.');
mkdirSync('artifacts', { recursive: true });
const result = spawnSync(
  'xcodebuild',
  [
    '-project',
    'ios/App/App.xcodeproj',
    '-scheme',
    'App',
    '-configuration',
    'Debug',
    '-destination',
    `platform=iOS Simulator,id=${device.udid}`,
    '-resultBundlePath',
    `artifacts/ios-${Date.now()}.xcresult`,
    'CODE_SIGNING_ALLOWED=NO',
    'test',
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
