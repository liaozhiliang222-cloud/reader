import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import process from 'node:process';
import { Buffer } from 'node:buffer';

// Rasterize the same original book motif without font/network or image dependencies.
const lines = [
  [128, 150, 190, 136],
  [190, 136, 256, 166],
  [256, 166, 322, 136],
  [322, 136, 384, 150],
  [384, 150, 384, 342],
  [384, 342, 322, 328],
  [322, 328, 256, 358],
  [256, 358, 190, 328],
  [190, 328, 128, 342],
  [128, 342, 128, 150],
  [256, 166, 256, 358],
  [158, 200, 192, 194],
  [192, 194, 226, 209],
  [158, 246, 192, 240],
  [192, 240, 226, 255],
  [286, 209, 320, 194],
  [320, 194, 354, 200],
  [286, 255, 320, 240],
  [320, 240, 354, 246],
];
function distance(x, y, [ax, ay, bx, by]) {
  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) /
        ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  return Math.hypot(x - ax - ratio * (bx - ax), y - ay - ratio * (by - ay));
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4);
  data.copy(result, 8);
  result.writeUInt32BE(
    crc(result.subarray(4, data.length + 8)),
    data.length + 8,
  );
  return result;
}
function png(size) {
  const row = size * 3 + 1,
    pixels = Buffer.alloc(row * size);
  const paper = [245, 240, 230],
    ink = [71, 63, 52];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      // Four samples keep small home-screen icons smooth. All content stays within maskable safe area.
      for (const dx of [0.25, 0.75])
        for (const dy of [0.25, 0.75]) {
          const px = ((x + dx) * 512) / size,
            py = ((y + dy) * 512) / size;
          if (lines.some((line) => distance(px, py, line) <= 7)) alpha += 0.25;
        }
      for (let channel = 0; channel < 3; channel++) {
        pixels[y * row + 1 + x * 3 + channel] = Math.round(
          paper[channel] * (1 - alpha) + ink[channel] * alpha,
        );
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const directory = resolve('public/icons');
await mkdir(directory, { recursive: true });
for (const [name, size] of [
  ['icon-192', 192],
  ['icon-512', 512],
  ['maskable-512', 512],
  ['apple-touch-icon', 180],
]) {
  await writeFile(resolve(directory, `${name}.png`), png(size));
}
process.stdout.write('Generated 192/512/maskable/180 local icons.\n');
