import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const result = await build({
  configFile: false,
  resolve: { alias: { '@': resolve('src') } },
  build: {
    write: false,
    minify: true,
    lib: {
      entry: resolve('android/tts-probe/web/main.ts'),
      name: 'TtsPrepareProbe',
      formats: ['iife'],
    },
  },
});
const outputs = Array.isArray(result) ? result : [result];
const chunks = outputs.flatMap((output) =>
  'output' in output
    ? output.output.filter((item) => item.type === 'chunk')
    : [],
);
if (chunks.length !== 1) throw new Error('Expected one inline probe script.');
const directory = resolve('android/tts-probe/build/generated/tts-web');
await mkdir(directory, { recursive: true });
const script = chunks[0].code.replace(/<\/script/gi, '<\\/script');
await writeFile(
  resolve(directory, 'prepare.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-probe'; style-src 'nonce-probe'"><title>T0 准备性能</title><style nonce="probe">body{font:16px system-ui;padding:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><p>仅测试原创文本，不播放声音。</p><pre id="status">等待选择测试规模</pre><script nonce="probe">${script}</script></html>`,
);
process.stdout.write('Prepared isolated WebView benchmark asset.\n');
