import { readFileSync } from 'node:fs';
const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const objects = [
  ...project.matchAll(
    /\b([A-F0-9]+)\s*(?:\/\*[^\n]*?\*\/\s*)?=\s*\{\s*isa\s*=/g,
  ),
].map((match) => match[1]);
if (
  objects.some((id) => id.length !== 24) ||
  new Set(objects).size !== objects.length
)
  throw new Error('Xcode object IDs are invalid or duplicated');
for (const name of [
  'JyReaderPlugin.swift',
  'ReaderBridgeViewController.swift',
  'SpeechController.swift',
  'JySpeechPlugin.swift',
  'SpeechQueueStore.swift',
  'SpeechQueueStoreTests.swift',
  'JyDocumentsPlugin.swift',
  'PdfDocumentStoreTests.swift',
]) {
  if (!project.includes(name)) throw new Error(`Xcode is missing ${name}`);
}
if (!project.includes('com.apple.product-type.bundle.unit-test'))
  throw new Error('Missing XCTest target');
const scheme = readFileSync(
  'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
  'utf8',
);
if (!scheme.includes('AppTests.xctest'))
  throw new Error('Shared scheme does not run XCTest');
if (
  /ProStore|\.storekit|StoreKitConfigurationFileReference/.test(
    project + scheme,
  )
)
  throw new Error(
    'The free first release must not include purchase configuration',
  );
if (!/PrivacyInfo\.xcprivacy in Resources/.test(project))
  throw new Error('Privacy manifest is not in App resources');
const manifest = readFileSync('ios/App/App/PrivacyInfo.xcprivacy', 'utf8');
for (const category of ['UserDefaults', 'SystemBootTime', 'FileTimestamp'])
  if (!manifest.includes(`NSPrivacyAccessedAPICategory${category}`))
    throw new Error(`Privacy manifest lacks ${category}`);
console.log(
  `iOS source configuration checked (${objects.length} Xcode objects); Swift compilation and device behavior require macOS.`,
);
