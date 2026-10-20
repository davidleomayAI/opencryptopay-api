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
/**
 * Allowed data lengths of the kept PNG chunks whose size the format fixes. A
 * kept ancillary chunk with another length is dropped, so no chunk can carry
 * extra bytes.
 */
const PNG_LENGTHS: ReadonlyMap<string, readonly number[]> = new Map([
  ['gAMA', [4]],
  ['cHRM', [32]],
  ['sRGB', [1]],
  ['cICP', [4]],
  ['pHYs', [9]],
]);
/**
 * Data length of the kept PNG chunks whose size depends on the colour type
 * (0 grey, 2 RGB, 3 indexed, 4 grey with alpha, 6 RGB with alpha). A missing
 * colour type means the chunk is not allowed there; indexed `tRNS` is checked
 * against the palette instead.
 */
const PNG_COLOUR_LENGTHS: ReadonlyMap<string, Readonly<Record<number, number>>> = new Map([
  ['sBIT', { 0: 1, 2: 3, 3: 3, 4: 2, 6: 4 }],
  ['bKGD', { 0: 2, 2: 6, 3: 1, 4: 2, 6: 6 }],
  ['tRNS', { 0: 2, 2: 6 }],
]);
const WEBP_FRAMES: ReadonlySet<string> = new Set(['VP8 ', 'VP8L']);

/** CRC-32 table (polynomial 0xEDB88320), as PNG uses it. */
const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc = (CRC_TABLE[(crc ^ value) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function be32Bytes(value: number): Uint8Array {
  return new Uint8Array([value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

/** A PNG chunk rebuilt from its type and data, with a freshly computed CRC. */
function pngChunk(type: Uint8Array, data: Uint8Array): Uint8Array {
  const typed = concat([type, data]);
  return concat([be32Bytes(data.length), typed, be32Bytes(crc32(typed))]);
}
const VP8X_ANIMATION = 0x02;
/** The only `VP8X` flag kept: alpha. ICC, EXIF, XMP and the reserved bits are cleared. */
const VP8X_ALPHA = 0x10;
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

/**
 * Markers that carry image data or decoding tables: SOFn, DHT, DAC, SOS, DQT,
 * DNL and DRI. Every other marker with a length (JPG, JPGn, DHP, EXP,
 * reserved) is dropped.
 */
function isImageMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) || (marker >= 0xda && marker <= 0xdd)
  );
}

/** Whether a kept marker of fixed layout has its length: DNL and DRI 4, DAC pairs of bytes. */
function hasMarkerLength(marker: number, length: number): boolean {
  if (marker === 0xdc || marker === 0xdd) {
    return length === 4;
  }
  return marker !== 0xcc || length % 2 === 0;
}

/**
 * The entropy-coded data that starts at `at`, up to the next marker other than
 * RSTn. Fill bytes (`FF`) before a stuffed zero or an RSTn stay in the scan and
 * are written as one `FF`, so their count carries nothing.
 *
 * @returns The end of the data and the bytes to keep, or null when no marker ends it.
 */
function scanData(bytes: Uint8Array, at: number): { end: number; data: Uint8Array } | null {
  const kept: Uint8Array[] = [];
  let start = at;
  let pos = at;
  while (pos + 1 < bytes.length) {
    if (byte(bytes, pos) !== 0xff) {
      pos += 1;
      continue;
    }
    let next = pos + 1;
    while (byte(bytes, next) === 0xff && next + 1 < bytes.length) {
      next += 1;
    }
    const code = byte(bytes, next);
    if (code !== 0x00 && !(code >= 0xd0 && code <= 0xd7)) {
      kept.push(bytes.subarray(start, pos));
      return { end: pos, data: concat(kept) };
    }
    kept.push(bytes.subarray(start, pos + 1));
    start = next;
    pos = next + 1;
  }
  return null;
}

function stripJpeg(bytes: Uint8Array): StripResult {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  let pos = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let exifAt = -1;
  let jfifKept = false;
  let adobeKept = false;
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
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // TEM and a stray RSTn stand alone, without a length, and mean nothing outside a scan.
      pos += 2;
      continue;
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
      if (!jfifKept && startsWith(content, 0, JFIF_ID) && content.length >= 14) {
        const header = new Uint8Array(14);
        header.set(content.subarray(0, 12));
        parts.push(segment(0xe0, header));
        jfifKept = true;
      }
    } else if (marker === 0xee) {
      if (!adobeKept && startsWith(content, 0, ADOBE_ID) && content.length >= 12) {
        parts.push(segment(0xee, content.slice(0, 12)));
        adobeKept = true;
      }
    } else if (marker === 0xe1) {
      if (exifAt === -1 && startsWith(content, 0, EXIF_ID)) {
        orientation = exifOrientation(content.subarray(EXIF_ID.length));
        exifAt = parts.length;
      }
    } else if (!isImageMarker(marker)) {
      // Dropped: ICC, XMP, MPF, maker data, comments and every unknown marker.
    } else {
      if (!hasMarkerLength(marker, length)) {
        return { ok: false, error: 'unreadable' };
      }
      if (isSof(marker) && width === 0) {
        if (length < 8) {
          return { ok: false, error: 'unreadable' };
        }
        height = be16(bytes, pos + 5);
        width = be16(bytes, pos + 7);
      }
      parts.push(bytes.slice(pos, end));
      if (marker === 0xda) {
        const scan = scanData(bytes, end);
        if (scan === null) {
          return { ok: false, error: 'unreadable' };
        }
        parts.push(scan.data);
        pos = scan.end;
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
  let colourType = 0;
  let bitDepth = 0;
  let paletteEntries = 0;
  let afterData = false;
  const seen = new Set<string>();
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
    if ((pos === 8) !== (type === 'IHDR') || (type === 'IHDR' && length !== 13)) {
      return { ok: false, error: 'unreadable' };
    }
    if (type === 'IHDR') {
      width = be32(bytes, pos + 8);
      height = be32(bytes, pos + 12);
      bitDepth = byte(bytes, pos + 16);
      colourType = byte(bytes, pos + 17);
    }
    if (type === 'acTL') {
      return { ok: false, error: 'animated' };
    }
    if (
      type === 'PLTE' &&
      (length < 3 ||
        length > 768 ||
        length % 3 !== 0 ||
        (colourType === 3 && length / 3 > 2 ** bitDepth))
    ) {
      return { ok: false, error: 'unreadable' };
    }
    if (type === 'IEND') {
      if (!afterData) {
        return { ok: false, error: 'unreadable' };
      }
      parts.push(pngChunk(bytes.subarray(pos + 4, pos + 8), new Uint8Array(0)));
      break;
    }
    // IHDR and IDAT always count; every other kept chunk only once and before the image data.
    const keep =
      type === 'IHDR' ||
      type === 'IDAT' ||
      (PNG_KEEP.has(type) &&
        !afterData &&
        !seen.has(type) &&
        pngChunkFits(type, bytes.subarray(pos + 8, end - 4), colourType, paletteEntries));
    if (keep) {
      parts.push(
        pngChunk(bytes.subarray(pos + 4, pos + 8), bytes.subarray(pos + 8, pos + 8 + length)),
      );
      seen.add(type);
    }
    if (type === 'PLTE' && keep) {
      paletteEntries = length / 3;
    }
    afterData ||= type === 'IDAT';
    pos = end;
  }
  return { ok: true, bytes: concat(parts), width, height };
}

/**
 * Whether a kept PNG chunk fits the image: `PLTE` only for an indexed image,
 * the fixed size, the size for the image's colour type, an indexed `tRNS` of 1
 * byte up to one per palette entry, and an indexed `bKGD` naming a palette
 * entry. Grey and RGB with alpha have no `tRNS`.
 */
function pngChunkFits(
  type: string,
  data: Uint8Array,
  colourType: number,
  paletteEntries: number,
): boolean {
  if (type === 'PLTE') {
    return colourType === 3;
  }
  if (type === 'tRNS' && colourType === 3) {
    return data.length >= 1 && data.length <= paletteEntries;
  }
  if (type === 'bKGD' && colourType === 3 && byte(data, 0) >= paletteEntries) {
    return false;
  }
  const byColour = PNG_COLOUR_LENGTHS.get(type);
  if (byColour !== undefined) {
    return byColour[colourType] === data.length;
  }
  // Every other kept ancillary chunk has a fixed size.
  return (PNG_LENGTHS.get(type) as readonly number[]).includes(data.length);
}

/** A WebP chunk rebuilt from its type and declared data, with a zero pad byte when odd. */
function webpChunk(type: Uint8Array, data: Uint8Array): Uint8Array {
  const size = data.length;
  const header = new Uint8Array([
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    size >>> 24,
  ]);
  return concat([type, header, data, new Uint8Array(size % 2)]);
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
  let alpha: Uint8Array | null = null;
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
      if (size !== 10 || pos !== 12) {
        return { ok: false, error: 'unreadable' };
      }
      if ((byte(data, 0) & VP8X_ANIMATION) !== 0) {
        return { ok: false, error: 'animated' };
      }
      canvas = { width: le24(data, 4) + 1, height: le24(data, 7) + 1 };
      const cleared = data.slice();
      cleared.set([byte(data, 0) & VP8X_ALPHA, 0, 0, 0]);
      parts.push(webpChunk(bytes.subarray(pos, pos + 4), cleared));
    } else if (type === 'ALPH') {
      // One ALPH, only after VP8X and before the frame; it is written with a VP8 frame only.
      if (canvas !== null && frame === null && alpha === null) {
        alpha = webpChunk(bytes.subarray(pos, pos + 4), data);
      }
    } else if (WEBP_FRAMES.has(type) && frame === null) {
      // Only the first frame chunk is kept; a later one is never shown.
      if (type === 'VP8 ') {
        if (size < 10 || !startsWith(data, 3, [0x9d, 0x01, 0x2a])) {
          return { ok: false, error: 'unreadable' };
        }
        frame = { width: le16(data, 6) & 0x3fff, height: le16(data, 8) & 0x3fff };
        if (alpha !== null) {
          parts.push(alpha);
        }
      } else {
        if (size < 5 || byte(data, 0) !== 0x2f) {
          return { ok: false, error: 'unreadable' };
        }
        const bits = le32(data, 1);
        frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      parts.push(webpChunk(bytes.subarray(pos, pos + 4), data));
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
 * Remove metadata from a photo by allow-list and read its displayed size. JPEG keeps the first
 * plain JFIF header without thumbnail, the first 12-byte Adobe segment, a minimal EXIF orientation
 * when the original held 2 to 8, and the image markers (SOFn, DHT, DAC, SOS with its scan data,
 * where fill bytes before an RSTn become one FF, DQT, DNL, DRI) up to the main image's EOI; every
 * other marker, and TEM or RSTn outside a scan, is dropped. PNG needs an IDAT before IEND and keeps
 * the listed rendering chunks up to IEND, each rebuilt with a fresh CRC; an ancillary chunk or PLTE
 * is kept once and only before the first IDAT, PLTE only for an indexed image, a chunk of a length
 * the format does not allow or an indexed bKGD that names no palette entry is dropped, and IEND is
 * written empty. WebP keeps `VP8X` (first and exactly 10 bytes), one `ALPH` after `VP8X` and before
 * a `VP8 ` frame, and the first `VP8 ` or `VP8L` frame up to the RIFF end, each rebuilt from its
 * declared size with a zero pad byte, keeps only the alpha flag of `VP8X` with its reserved bytes
 * zeroed and rewrites the RIFF size. Every byte after the end of the image is cut. No metadata
 * segment or chunk survives; bytes inside a kept segment, such as DQT or DHT tables, are copied as
 * they are.
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
