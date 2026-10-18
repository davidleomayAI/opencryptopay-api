/**
 * Byte-level metadata removal for shop photos. Nothing is decoded or
 * re-encoded: JPEG markers, PNG chunks and WebP chunks are walked and kept by
 * an allow-list, so no image library is needed.
 */

/** Stored photo types. */
export type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Why a photo could not be stored. */
export type StripError = 'unreadable' | 'animated';

/** Result of {@link stripPhotoMetadata}. */
export type StripResult =
  { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; error: StripError };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEEP: ReadonlySet<string> = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'cICP',
  'sBIT',
  'pHYs',
  'bKGD',
]);
const WEBP_KEEP: ReadonlySet<string> = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH']);
const VP8X_ANIMATION = 0x02;
const VP8X_CLEAR = 0x20 | 0x08 | 0x04;
const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00];
const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const ADOBE_ID = [0x41, 0x64, 0x6f, 0x62, 0x65];

/** The byte at `at`, or 0 past the end, so a short file reads as zeros. */
function byte(bytes: Uint8Array, at: number): number {
  return bytes[at] ?? 0;
}

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  return (
    at + prefix.length <= bytes.length && prefix.every((value, i) => byte(bytes, at + i) === value)
  );
}

function be16(bytes: Uint8Array, at: number): number {
  return (byte(bytes, at) << 8) | byte(bytes, at + 1);
}

function be32(bytes: Uint8Array, at: number): number {
  return be16(bytes, at) * 0x10000 + be16(bytes, at + 2);
}

function le16(bytes: Uint8Array, at: number): number {
  return byte(bytes, at) | (byte(bytes, at + 1) << 8);
}

function le24(bytes: Uint8Array, at: number): number {
  return le16(bytes, at) | (byte(bytes, at + 2) << 16);
}

function le32(bytes: Uint8Array, at: number): number {
  return le16(bytes, at) + le16(bytes, at + 2) * 0x10000;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function segment(marker: number, content: Uint8Array): Uint8Array {
  const length = content.length + 2;
  return concat([new Uint8Array([0xff, marker, length >>> 8, length & 0xff]), content]);
}

/**
 * Orientation tag (0x0112) of an EXIF APP1 body, 1 when absent or unreadable.
 * The body starts after the `Exif\0\0` identifier.
 */
function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) {
    return 1;
  }
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') {
    return 1;
  }
  const little = order === 'II';
  const u16 = (at: number): number => (little ? le16(tiff, at) : be16(tiff, at));
  const u32 = (at: number): number => (little ? le32(tiff, at) : be32(tiff, at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) {
    return 1;
  }
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) {
      return 1;
    }
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
      const value = u16(entry + 8);
      return value >= 2 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Minimal APP1 EXIF body holding only the orientation tag. */
function orientationApp1(orientation: number): Uint8Array {
  return segment(
    0xe1,
    new Uint8Array([
      ...EXIF_ID,
      0x4d,
      0x4d,
      0x00,
      0x2a,
      0x00,
      0x00,
      0x00,
      0x08,
      0x00,
      0x01,
      0x01,
      0x12,
      0x00,
      0x03,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      orientation,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]),
  );
}

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** End of the entropy-coded data that starts at `at`: the next marker other than RSTn. */
function scanEnd(bytes: Uint8Array, at: number): number {
  let pos = at;
  while (pos + 1 < bytes.length) {
    if (byte(bytes, pos) === 0xff) {
      const next = byte(bytes, pos + 1);
      if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) {
        return pos;
      }
    }
    pos += 1;
  }
  return -1;
}

function stripJpeg(bytes: Uint8Array): StripResult {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  let pos = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let exifAt = -1;
  for (;;) {
    if (pos + 2 > bytes.length || byte(bytes, pos) !== 0xff) {
      return { ok: false, error: 'unreadable' };
    }
    while (byte(bytes, pos + 1) === 0xff) {
      pos += 1;
    }
    const marker = byte(bytes, pos + 1);
    if (marker === 0xd9) {
      parts.push(new Uint8Array([0xff, 0xd9]));
      break;
    }
    if (pos + 4 > bytes.length) {
      return { ok: false, error: 'unreadable' };
    }
    const length = be16(bytes, pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) {
      return { ok: false, error: 'unreadable' };
    }
    const content = bytes.subarray(pos + 4, end);
    if (marker === 0xe0) {
      if (startsWith(content, 0, JFIF_ID) && content.length >= 14) {
        const header = new Uint8Array(14);
        header.set(content.subarray(0, 12));
        parts.push(segment(0xe0, header));
      }
    } else if (marker === 0xee) {
      if (startsWith(content, 0, ADOBE_ID) && content.length >= 12) {
        parts.push(segment(0xee, content.slice(0, 12)));
      }
    } else if (marker === 0xe1) {
      if (exifAt === -1 && startsWith(content, 0, EXIF_ID)) {
        orientation = exifOrientation(content.subarray(EXIF_ID.length));
        exifAt = parts.length;
      }
    } else if ((marker >= 0xe2 && marker <= 0xef) || marker === 0xfe) {
      // Dropped: ICC, XMP, MPF, maker data and comments.
    } else {
      if (isSof(marker) && width === 0) {
        if (length < 8) {
          return { ok: false, error: 'unreadable' };
        }
        height = be16(bytes, pos + 5);
        width = be16(bytes, pos + 7);
      }
      parts.push(bytes.slice(pos, end));
      if (marker === 0xda) {
        const dataEnd = scanEnd(bytes, end);
        if (dataEnd === -1) {
          return { ok: false, error: 'unreadable' };
        }
        parts.push(bytes.slice(end, dataEnd));
        pos = dataEnd;
        continue;
      }
    }
    pos = end;
  }
  if (width === 0) {
    return { ok: false, error: 'unreadable' };
  }
  if (orientation !== 1) {
    parts.splice(exifAt, 0, orientationApp1(orientation));
  }
  const swap = orientation >= 5;
  return {
    ok: true,
    bytes: concat(parts),
    width: swap ? height : width,
    height: swap ? width : height,
  };
}

function stripPng(bytes: Uint8Array): StripResult {
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  let pos = 8;
  let width = 0;
  let height = 0;
  for (;;) {
    if (pos + 12 > bytes.length) {
      return { ok: false, error: 'unreadable' };
    }
    const length = be32(bytes, pos);
    const type = ascii(bytes, pos + 4, 4);
    const end = pos + 12 + length;
    if (end > bytes.length) {
      return { ok: false, error: 'unreadable' };
    }
    if (pos === 8) {
      if (type !== 'IHDR' || length !== 13) {
        return { ok: false, error: 'unreadable' };
      }
      width = be32(bytes, pos + 8);
      height = be32(bytes, pos + 12);
    }
    if (type === 'acTL') {
      return { ok: false, error: 'animated' };
    }
    if (PNG_KEEP.has(type)) {
      parts.push(bytes.slice(pos, end));
    }
    pos = end;
    if (type === 'IEND') {
      break;
    }
  }
  return { ok: true, bytes: concat(parts), width, height };
}

function stripWebp(bytes: Uint8Array): StripResult {
  if (bytes.length < 12) {
    return { ok: false, error: 'unreadable' };
  }
  const riffEnd = 8 + le32(bytes, 4);
  if (riffEnd > bytes.length) {
    return { ok: false, error: 'unreadable' };
  }
  const parts: Uint8Array[] = [];
  let pos = 12;
  let canvas: { width: number; height: number } | null = null;
  let frame: { width: number; height: number } | null = null;
  while (pos < riffEnd) {
    if (pos + 8 > riffEnd) {
      return { ok: false, error: 'unreadable' };
    }
    const type = ascii(bytes, pos, 4);
    const size = le32(bytes, pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (end > riffEnd) {
      return { ok: false, error: 'unreadable' };
    }
    const data = bytes.subarray(pos + 8, pos + 8 + size);
    if (type === 'ANIM' || type === 'ANMF') {
      return { ok: false, error: 'animated' };
    }
    if (type === 'VP8X') {
      if (size < 10) {
        return { ok: false, error: 'unreadable' };
      }
      if ((byte(data, 0) & VP8X_ANIMATION) !== 0) {
        return { ok: false, error: 'animated' };
      }
      canvas = { width: le24(data, 4) + 1, height: le24(data, 7) + 1 };
      const chunk = bytes.slice(pos, end);
      chunk[8] = byte(chunk, 8) & ~VP8X_CLEAR;
      parts.push(chunk);
    } else if (WEBP_KEEP.has(type)) {
      if (type === 'VP8 ' && frame === null) {
        if (size < 10 || !startsWith(data, 3, [0x9d, 0x01, 0x2a])) {
          return { ok: false, error: 'unreadable' };
        }
        frame = { width: le16(data, 6) & 0x3fff, height: le16(data, 8) & 0x3fff };
      } else if (type === 'VP8L' && frame === null) {
        if (size < 5 || byte(data, 0) !== 0x2f) {
          return { ok: false, error: 'unreadable' };
        }
        const bits = le32(data, 1);
        frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      parts.push(bytes.slice(pos, end));
    }
    pos = end;
  }
  if (frame === null) {
    return { ok: false, error: 'unreadable' };
  }
  const body = concat(parts);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 4));
  const riffSize = body.length + 4;
  header.set(
    [riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, riffSize >>> 24],
    4,
  );
  header.set(bytes.subarray(8, 12), 8);
  const size = canvas ?? frame;
  return { ok: true, bytes: concat([header, body]), width: size.width, height: size.height };
}

/**
 * File extension of a stored photo type, as used in `/map/photos/{sha256}.{ext}`.
 *
 * @param type - Stored content type.
 * @returns `jpg`, `png` or `webp`.
 */
export function photoExtension(type: PhotoType): 'jpg' | 'png' | 'webp' {
  if (type === 'image/jpeg') {
    return 'jpg';
  }
  return type === 'image/png' ? 'png' : 'webp';
}

/**
 * The file type named by the magic bytes.
 *
 * @param bytes - Decoded photo file.
 * @returns The type, or null when it is not a JPEG, PNG or WebP file.
 */
export function photoTypeOf(bytes: Uint8Array): PhotoType | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, 0, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * Remove metadata from a photo by allow-list and read its displayed size.
 * JPEG keeps a plain JFIF header without thumbnail, a 12-byte Adobe segment,
 * a minimal EXIF orientation when the original held 2 to 8, and every non-APP,
 * non-comment marker up to the main image's EOI. PNG keeps the listed
 * rendering chunks up to IEND. WebP keeps `VP8 `, `VP8L`, `VP8X` and `ALPH`
 * up to the RIFF end, clears the ICC, EXIF and XMP flags and rewrites the
 * RIFF size. Every byte after the end of the image is cut.
 *
 * @param type - The file type read from the magic bytes.
 * @param bytes - Decoded photo file.
 * @returns The stripped bytes and the displayed width and height (JPEG
 * orientation 5 to 8 swaps them), or `unreadable` or `animated`.
 */
export function stripPhotoMetadata(type: PhotoType, bytes: Uint8Array): StripResult {
  if (type === 'image/jpeg') {
    return stripJpeg(bytes);
  }
  if (type === 'image/png') {
    return stripPng(bytes);
  }
  return stripWebp(bytes);
}
