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
  'ProStore.swift',
  'JySpeechPlugin.swift',
  'SpeechQueueStore.swift',
  'SpeechQueueStoreTests.swift',
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
const product = JSON.parse(readFileSync('ios/App/JingyePro.storekit', 'utf8'))
  .products[0];
if (
  product.productID !== 'dev.jingye.reader.pro' ||
  product.type !== 'NonConsumable'
)
  throw new Error('StoreKit test product mismatch');
if (/JingyePro.storekit in Resources/.test(project))
  throw new Error('Test store must not ship in app resources');
console.log(
  `iOS source configuration checked (${objects.length} Xcode objects); Swift compilation and device behavior require macOS.`,
);
