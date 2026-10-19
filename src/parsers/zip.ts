import { t } from '@/i18n';
import { Inflate, type ZStream } from 'pako';
import { scanZip, updateCrc, type ZipRecord } from './zipDirectory';

export interface ZipLimits {
  input: number;
  entries: number;
  entry: number;
  total: number;
}
export class BoundedZip {
  private consumed = 0;
  private failed = false;
  private verified = new Set<string>();
  private constructor(
    private source: ArrayBuffer | Blob,
    private limits: ZipLimits,
    private records: Map<string, ZipRecord>,
  ) {}
  static async load(source: ArrayBuffer | Blob, limits: ZipLimits) {
    const records = await scanZip(source, limits);
    return new BoundedZip(
      source,
      { ...limits },
      new Map(records.map((entry) => [entry.name, entry])),
    );
  }
  has(path: string) {
    const entry = this.records.get(path);
    return !!entry && !entry.dir;
  }
  paths() {
    return [...this.records.values()]
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name);
  }
  size(path: string) {
    const entry = this.records.get(path);
    return entry && !entry.dir ? entry.size : undefined;
  }
  /** Apply a tighter aggregate budget after bounded metadata has been read. */
  restrictTotal(bytes: number) {
    const total = [...this.records.values()].reduce(
      (sum, entry) => sum + entry.size,
      0,
    );
    if (!Number.isSafeInteger(bytes) || total > bytes || this.consumed > bytes)
      throw new Error(t('解压后的总大小与备份信息不一致。'));
    this.limits.total = Math.min(this.limits.total, bytes);
  }
  async read(
    path: string,
    maxBytes = this.limits.entry,
    discard = false,
  ): Promise<Blob> {
    if (this.failed) throw new Error(t('压缩包校验已失败，已停止读取。'));
    const entry = this.records.get(path);
    if (!entry) throw new Error(t('文件无法解析：缺少 {0}', path));
    const limit = Math.min(maxBytes, this.limits.entry);
    if (entry.size > limit)
      throw new Error(t('解压后的文件大小超限：{0}', path));
    const parts: ArrayBuffer[] = [];
    let size = 0,
      crc = 0xffffffff;
    const accept = (bytes: Uint8Array) => {
      size += bytes.byteLength;
      this.consumed += bytes.byteLength;
      if (
        size > limit ||
        size > entry.size ||
        this.consumed > this.limits.total
      )
        throw new Error(t('实际解压大小超限或与压缩包声明不一致。'));
      crc = updateCrc(crc, bytes);
      if (!discard) parts.push(Uint8Array.from(bytes).buffer);
    };
    try {
      const inflate =
        entry.method === 8
          ? new Inflate({ raw: true, chunkSize: 16384 })
          : undefined;
      let stream: ZStream | undefined;
      if (inflate) {
        inflate.onStart = (value) => {
          stream = value;
        };
        inflate.onData = accept;
      }
      for (let offset = entry.dataStart; offset < entry.dataEnd;) {
        const end = Math.min(offset + 65536, entry.dataEnd);
        const bytes =
          this.source instanceof ArrayBuffer
            ? new Uint8Array(this.source, offset, end - offset)
            : new Uint8Array(
                await this.source.slice(offset, end).arrayBuffer(),
              );
        if (inflate) {
          if (!inflate.push(bytes, end === entry.dataEnd))
            throw new Error(t('ZIP 解压流损坏或截断：{0}', path));
          if (
            inflate.ended &&
            (end !== entry.dataEnd || stream?.total_in !== entry.compressedSize)
          )
            throw new Error(t('ZIP 解压流含多余数据：{0}', path));
        } else accept(bytes);
        offset = end;
      }
      if (inflate && (!inflate.ended || inflate.err))
        throw new Error(t('ZIP 解压流不完整：{0}', path));
      if (size !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
        throw new Error(t('压缩包条目不完整或CRC校验失败：{0}', path));
      this.verified.add(path);
      return new Blob(parts);
    } catch (cause) {
      this.failed = true;
      parts.length = 0;
      throw cause;
    }
  }
  /** Validate unused entries without retaining their expanded bytes. */
  async verifyRemaining() {
    for (const path of this.records.keys())
      if (!this.verified.has(path)) await this.read(path, undefined, true);
  }
}
