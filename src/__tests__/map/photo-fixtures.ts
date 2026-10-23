/**
 * Builders for small JPEG, PNG and WebP files with chosen segments and chunks.
 * The image data is not decodable; the metadata walk never decodes.
 */

export function bytesOf(...parts: Array<Uint8Array | readonly number[] | string>): Uint8Array {
  const arrays = parts.map((part) =>
    typeof part === 'string'
      ? new Uint8Array([...part].map((char) => char.charCodeAt(0)))
      : Uint8Array.from(part),
  );
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function be16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function le24(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** One JPEG marker segment with its length. */
export function jpegSegment(
  marker: number,
  content: Uint8Array | readonly number[] | string,
): Uint8Array {
  const body = bytesOf(content);
  return bytesOf([0xff, marker], be16(body.length + 2), body);
}

/** JFIF APP0 content with a 1×1 thumbnail of 3 bytes. */
export const JFIF_WITH_THUMBNAIL = bytesOf(
  'JFIF\0',
  [1, 2, 0],
  be16(72),
  be16(72),
  [1, 1, 9, 9, 9],
);

/** A TIFF block with one IFD0 entry (0x0112 orientation, SHORT) in the given byte order. */
export function exifTiff(order: 'II' | 'MM', orientation: number, extraEntries = 0): Uint8Array {
  const u16 = order === 'II' ? le16 : be16;
  const u32 = order === 'II' ? le32 : be32;
  const entries: number[] = [];
  for (let i = 0; i < extraEntries; i += 1) {
    entries.push(...u16(0x010f), ...u16(2), ...u32(1), 0x41, 0, 0, 0);
  }
  entries.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0);
  return bytesOf(order, u16(42), u32(8), u16(extraEntries + 1), entries, u32(0));
}

/** SOF0 segment for a 3-component baseline image. */
export function sof(width: number, height: number, marker = 0xc0): Uint8Array {
  return jpegSegment(
    marker,
    bytesOf([8], be16(height), be16(width), [3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
  );
}

/** SOS segment followed by entropy data that holds a stuffed byte and a restart marker. */
export function scan(): Uint8Array {
  return bytesOf(
    jpegSegment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    [0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56],
  );
}

/** A JPEG: SOI, the given segments, then EOI and any trailing bytes. */
export function jpeg(segments: Uint8Array[], trailing: readonly number[] = []): Uint8Array {
  return bytesOf([0xff, 0xd8], ...segments, [0xff, 0xd9], trailing);
}

/** A plain JPEG of the given size. */
export function simpleJpeg(width = 2, height = 1): Uint8Array {
  return jpeg([jpegSegment(0xdb, new Uint8Array(65)), sof(width, height), scan()]);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk with its CRC. */
export function pngChunk(
  type: string,
  data: Uint8Array | readonly number[] | string = [],
): Uint8Array {
  const typed = bytesOf(type, data);
  return bytesOf(be32(typed.length - 4), typed, be32(crc32(typed)));
}

/** IHDR for an 8-bit image of the given colour type (2 is RGB, 3 indexed). */
export function ihdr(width: number, height: number, colourType = 2): Uint8Array {
  return pngChunk('IHDR', bytesOf(be32(width), be32(height), [8, colourType, 0, 0, 0]));
}

/** A PNG: signature, the given chunks, IEND and any trailing bytes. */
export function png(chunks: Uint8Array[], trailing: readonly number[] = []): Uint8Array {
  return bytesOf(PNG_SIGNATURE, ...chunks, pngChunk('IEND'), trailing);
}

/** A plain PNG of the given size. */
export function simplePng(width = 3, height = 2): Uint8Array {
  return png([ihdr(width, height), pngChunk('IDAT', [1, 2, 3])]);
}

/** One WebP chunk with its pad byte when the size is odd. */
export function webpChunk(type: string, data: Uint8Array | readonly number[] | string): Uint8Array {
  const body = bytesOf(data);
  return bytesOf(type, le32(body.length), body, body.length % 2 === 1 ? [0] : []);
}

/** VP8 (lossy) chunk data for the given size. */
export function vp8(width: number, height: number): Uint8Array {
  return bytesOf([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], le16(width), le16(height), [0, 0]);
}

/** VP8L (lossless) chunk data for the given size. */
export function vp8l(width: number, height: number): Uint8Array {
  return bytesOf([0x2f], le32((width - 1) | ((height - 1) << 14)));
}

/** VP8X chunk data with the given flags and canvas size. */
export function vp8x(flags: number, width: number, height: number): Uint8Array {
  return bytesOf([flags, 0, 0, 0], le24(width - 1), le24(height - 1));
}

/** A WebP: RIFF header with the right size, the given chunks and any trailing bytes. */
export function webp(chunks: Uint8Array[], trailing: readonly number[] = []): Uint8Array {
  const body = bytesOf(...chunks);
  return bytesOf('RIFF', le32(body.length + 4), 'WEBP', body, trailing);
}

/** A plain lossy WebP of the given size. */
export function simpleWebp(width = 4, height = 3): Uint8Array {
  return webp([webpChunk('VP8 ', vp8(width, height))]);
}

/** Base64 of a file, as a source sends it. */
export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
