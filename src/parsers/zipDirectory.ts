import type { ZipLimits } from './zip';

export interface ZipRecord {
  name: string;
  dir: boolean;
  size: number;
  crc: number;
  compressedSize: number;
  method: number;
  dataStart: number;
  dataEnd: number;
}
const corrupt = () => new Error('文件无法解析：ZIP 目录结构不支持或已损坏。');
const utf8 = new TextDecoder('utf-8', { fatal: true });
export function decodeZipName(bytes: Uint8Array) {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new Error('ZIP 资源名称不是 UTF-8，请重新打包。');
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function updateCrc(crc: number, bytes: Uint8Array) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return crc;
}
function extraFields(bytes: Uint8Array) {
  const fields = new Map<number, DataView>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) throw corrupt();
    const id = view.getUint16(offset, true),
      size = view.getUint16(offset + 2, true);
    if (offset + 4 + size > bytes.length || fields.has(id)) throw corrupt();
    fields.set(
      id,
      new DataView(bytes.buffer, bytes.byteOffset + offset + 4, size),
    );
    offset += 4 + size;
  }
  return fields;
}
function safe64(view: DataView | undefined, offset: number) {
  if (!view || offset + 8 > view.byteLength) throw corrupt();
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw corrupt();
  return Number(value);
}
function pathName(
  raw: Uint8Array,
  flags: number,
  extra: Map<number, DataView>,
) {
  const unicode = extra.get(0x7075);
  const hasUnicode =
    !(flags & 0x800) &&
    unicode &&
    unicode.byteLength >= 5 &&
    unicode.getUint8(0) === 1 &&
    unicode.getUint32(1, true) ===
      (updateCrc(0xffffffff, raw) ^ 0xffffffff) >>> 0;
  const name = hasUnicode
    ? decodeZipName(
        new Uint8Array(
          unicode.buffer,
          unicode.byteOffset + 5,
          unicode.byteLength - 5,
        ),
      )
    : decodeZipName(raw);
  const parts = name.replace(/\/$/, '').split('/');
  if (
    !name ||
    name.includes('\\') ||
    /^[a-z][a-z\d+.-]*:/i.test(name) ||
    Array.from(name).some(
      (char) => char.charCodeAt(0) < 32 || char === '\x7f',
    ) ||
    parts.some((part) => !part || part === '..' || part === '.')
  )
    throw new Error('压缩包包含无效资源路径。');
  return name;
}
export const zipSourceSize = (source: ArrayBuffer | Blob) =>
  source instanceof ArrayBuffer ? source.byteLength : source.size;
async function slice(source: ArrayBuffer | Blob, start: number, end: number) {
  if (start < 0 || end < start || end > zipSourceSize(source)) throw corrupt();
  return source instanceof ArrayBuffer
    ? source.slice(start, end)
    : source.slice(start, end).arrayBuffer();
}

/** Check the original directory before JSZip can normalize or overwrite names.
 * Blob input reads only metadata here, never the whole archive. */
export async function scanZip(source: ArrayBuffer | Blob, limits: ZipLimits) {
  const size = zipSourceSize(source);
  if (size > limits.input) throw new Error('压缩包文件过大，请拆分后导入。');
  if (size < 22) throw corrupt();
  const tailStart = Math.max(0, size - 65557);
  const tail = new DataView(await slice(source, tailStart, size));
  let end = -1;
  for (let at = tail.byteLength - 22; at >= 0; at--)
    if (
      tail.getUint32(at, true) === 0x06054b50 &&
      at + 22 + tail.getUint16(at + 20, true) === tail.byteLength
    ) {
      end = at;
      break;
    }
  if (end < 0) throw corrupt();
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true))
    throw new Error('不支持分卷 ZIP，请合并后导入。');
  let count = tail.getUint16(end + 10, true),
    directorySize = tail.getUint32(end + 12, true),
    directoryStart = tail.getUint32(end + 16, true),
    directoryEnd = tailStart + end;
  if (tail.getUint16(end + 8, true) !== count) throw corrupt();
  if (
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryStart === 0xffffffff
  ) {
    const locatorAt = tailStart + end - 20;
    const locator = new DataView(
      await slice(source, locatorAt, locatorAt + 20),
    );
    if (
      locator.getUint32(0, true) !== 0x07064b50 ||
      locator.getUint32(4, true) !== 0 ||
      locator.getUint32(16, true) !== 1
    )
      throw corrupt();
    const at = safe64(locator, 8),
      zip64 = new DataView(await slice(source, at, at + 56));
    if (
      zip64.getUint32(0, true) !== 0x06064b50 ||
      safe64(zip64, 4) < 44 ||
      at + 12 + safe64(zip64, 4) !== locatorAt ||
      zip64.getUint32(16, true) ||
      zip64.getUint32(20, true) ||
      safe64(zip64, 24) !== safe64(zip64, 32)
    )
      throw corrupt();
    count = safe64(zip64, 32);
    directorySize = safe64(zip64, 40);
    directoryStart = safe64(zip64, 48);
    directoryEnd = at;
  }
  if (count > limits.entries)
    throw new Error('压缩包文件数量过多，请拆分后导入。');
  // Name/comment/extra metadata cannot grow without a separate bound.
  if (directorySize > 32 * 1024 * 1024)
    throw new Error('ZIP 目录信息过大，请重新打包。');
  if (
    directoryStart + directorySize !== directoryEnd ||
    count * 46 > directorySize
  )
    throw corrupt();
  const bytes = new Uint8Array(
    await slice(source, directoryStart, directoryEnd),
  );
  const view = new DataView(bytes.buffer);
  const records: ZipRecord[] = [],
    names = new Set<string>(),
    ranges: { start: number; end: number }[] = [];
  let offset = 0,
    total = 0;
  for (let index = 0; index < count; index++) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw corrupt();
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true),
      crc = view.getUint32(offset + 16, true),
      nameLength = view.getUint16(offset + 28, true),
      extraLength = view.getUint16(offset + 30, true),
      commentLength = view.getUint16(offset + 32, true),
      attributes = view.getUint32(offset + 38, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw corrupt();
    if (flags & (1 | 0x40 | 0x2000))
      throw new Error('不支持加密 ZIP，请先解密文件。');
    if (flags & ~(0x800 | 8 | 6) || (method !== 0 && method !== 8))
      throw new Error('ZIP 压缩方式不受支持，请使用 STORE 或 DEFLATE。');
    if (((attributes >>> 16) & 0xf000) === 0xa000)
      throw new Error('ZIP 不支持符号链接资源。');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength),
      extra = extraFields(
        bytes.subarray(
          offset + 46 + nameLength,
          offset + 46 + nameLength + extraLength,
        ),
      ),
      name = pathName(rawName, flags, extra),
      key = name.replace(/\/$/, '');
    if (names.has(key)) throw new Error('ZIP 包含重复资源路径。');
    names.add(key);
    let uncompressed = view.getUint32(offset + 24, true),
      compressed = view.getUint32(offset + 20, true),
      localAt = view.getUint32(offset + 42, true),
      disk = view.getUint16(offset + 34, true),
      extraAt = 0;
    const zip64 = extra.get(1);
    const wide = uncompressed === 0xffffffff || compressed === 0xffffffff;
    if (uncompressed === 0xffffffff) {
      uncompressed = safe64(zip64, extraAt);
      extraAt += 8;
    }
    if (compressed === 0xffffffff) {
      compressed = safe64(zip64, extraAt);
      extraAt += 8;
    }
    if (localAt === 0xffffffff) {
      localAt = safe64(zip64, extraAt);
      extraAt += 8;
    }
    if (disk === 0xffff) {
      if (!zip64 || extraAt + 4 > zip64.byteLength) throw corrupt();
      disk = zip64.getUint32(extraAt, true);
    }
    if (disk) throw new Error('不支持分卷 ZIP，请合并后导入。');
    total += uncompressed;
    if (uncompressed > limits.entry || total > limits.total)
      throw new Error('解压后的文件过大，请拆分后导入。');
    if (compressed > limits.entry + Math.ceil(limits.entry / 1000) + 65536)
      throw new Error('ZIP 单条压缩数据过大，请拆分后导入。');
    if (method === 0 && compressed !== uncompressed) throw corrupt();
    if (localAt + 30 > directoryStart) throw corrupt();
    const local = new DataView(await slice(source, localAt, localAt + 30));
    if (
      local.getUint32(0, true) !== 0x04034b50 ||
      local.getUint16(6, true) !== flags ||
      local.getUint16(8, true) !== method ||
      local.getUint16(26, true) !== nameLength
    )
      throw corrupt();
    const localExtraLength = local.getUint16(28, true),
      dataStart = localAt + 30 + nameLength + localExtraLength,
      dataEnd = dataStart + compressed;
    if (dataEnd > directoryStart) throw corrupt();
    const localNames = new Uint8Array(
      await slice(source, localAt + 30, dataStart),
    );
    if (rawName.some((byte, at) => byte !== localNames[at])) throw corrupt();
    const localExtra = extraFields(localNames.subarray(nameLength));
    let localSize = local.getUint32(22, true),
      localCompressed = local.getUint32(18, true),
      localExtraAt = 0;
    if (localSize === 0xffffffff) {
      localSize = safe64(localExtra.get(1), localExtraAt);
      localExtraAt += 8;
    }
    if (localCompressed === 0xffffffff)
      localCompressed = safe64(localExtra.get(1), localExtraAt);
    if (
      !(flags & 8) &&
      (localSize !== uncompressed ||
        localCompressed !== compressed ||
        local.getUint32(14, true) !== crc)
    )
      throw corrupt();
    let rangeEnd = dataEnd;
    if (flags & 8) {
      if (
        (localSize !== 0 && localSize !== uncompressed) ||
        (localCompressed !== 0 && localCompressed !== compressed) ||
        (local.getUint32(14, true) !== 0 && local.getUint32(14, true) !== crc)
      )
        throw corrupt();
      const descriptor = new DataView(
        await slice(source, dataEnd, Math.min(dataEnd + 24, directoryStart)),
      );
      const match = (start: number) => {
        const width = wide ? 8 : 4;
        if (
          start + 4 + 2 * width > descriptor.byteLength ||
          descriptor.getUint32(start, true) !== crc
        )
          return 0;
        const read = (at: number) =>
          wide ? safe64(descriptor, at) : descriptor.getUint32(at, true);
        return read(start + 4) === compressed &&
          read(start + 4 + width) === uncompressed
          ? start + 4 + 2 * width
          : 0;
      };
      const descriptorSize =
        (descriptor.byteLength >= 4 &&
        descriptor.getUint32(0, true) === 0x08074b50
          ? match(4)
          : 0) || match(0);
      if (!descriptorSize) throw corrupt();
      rangeEnd += descriptorSize;
    }
    const dir = name.endsWith('/') || !!(attributes & 16);
    if (dir && (uncompressed || crc)) throw corrupt();
    records.push({
      name,
      dir,
      size: uncompressed,
      crc,
      compressedSize: compressed,
      method,
      dataStart,
      dataEnd,
    });
    ranges.push({ start: localAt, end: rangeEnd });
    offset = next;
  }
  if (offset !== bytes.length) throw corrupt();
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++)
    if (ranges[index]!.start < ranges[index - 1]!.end)
      throw new Error('ZIP 资源数据区重叠。');
  return records;
}
