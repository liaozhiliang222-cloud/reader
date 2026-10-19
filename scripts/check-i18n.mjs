import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const catalog = new Map();
const source = ts.createSourceFile(
  'en.ts',
  fs.readFileSync('src/i18n/en.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
function collect(node) {
  if (
    ts.isPropertyAssignment(node) &&
    (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name)) &&
    ts.isStringLiteral(node.initializer)
  ) {
    if (catalog.has(node.name.text))
      throw Error(`Duplicate translation: ${node.name.text}`);
    catalog.set(node.name.text, node.initializer.text);
  }
  node.forEachChild(collect);
}
collect(source);
const placeholders = (value) =>
  [...value.matchAll(/\{\d+\}/g)]
    .map((match) => match[0])
    .sort()
    .join(',');
for (const [chinese, english] of catalog) {
  if (!english.trim() || /\p{Script=Han}/u.test(english))
    throw Error(`Missing English: ${chinese}`);
  if (placeholders(chinese) !== placeholders(english))
    throw Error(`Translation placeholders differ: ${chinese}`);
}
let calls = 0;
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['fixtures', 'i18n'].includes(entry.name)) check(file);
      continue;
    }
    if (!/\.tsx?$/.test(file) || /\.test\.|[Ff]ixture/.test(file)) continue;
    const ast = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 't') {
        calls++;
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && !catalog.has(key.text))
          throw Error(`${file}: missing translation for ${key.text}`);
      }
      if (
        ts.isJsxText(node) &&
        /\p{Script=Han}/u.test(node.getText(ast)) &&
        !file.endsWith('LanguageSelector.tsx')
      )
        throw Error(`${file}: untranslated JSX text`);
      node.forEachChild(visit);
    }
    visit(ast);
  }
}
check('src');
for (const [locale, name] of [
  ['en', 'LumiRead'],
  ['zh-Hans', '微光阅读'],
]) {
  const strings = fs.readFileSync(
    `ios/App/App/${locale}.lproj/InfoPlist.strings`,
    'utf8',
  );
  if (!strings.includes(`"CFBundleDisplayName" = "${name}";`))
    throw Error(`Missing native name: ${locale}`);
}
console.log(
  `i18n checked: ${catalog.size} English messages, ${calls} translation calls, 2 native display names.`,
);
