import { describe, expect, it } from 'vitest';
import { photoExtension, photoTypeOf, stripPhotoMetadata } from '@/lib/map/photo-strip';
import {
  JFIF_WITH_THUMBNAIL,
  bytesOf,
  exifTiff,
  ihdr,
  jpeg,
  jpegSegment,
  png,
  pngChunk,
  scan,
  simpleJpeg,
  simplePng,
  simpleWebp,
  sof,
  vp8,
  vp8l,
  vp8x,
  webp,
  webpChunk,
} from './photo-fixtures';

const DQT = jpegSegment(0xdb, new Uint8Array(65));

function strip(type: 'image/jpeg' | 'image/png' | 'image/webp', bytes: Uint8Array) {
  return stripPhotoMetadata(type, bytes);
}

function stripped(type: 'image/jpeg' | 'image/png' | 'image/webp', bytes: Uint8Array) {
  const result = strip(type, bytes);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

function contains(haystack: Uint8Array, needle: Uint8Array | readonly number[] | string): boolean {
  const target = bytesOf(needle);
  outer: for (let i = 0; i + target.length <= haystack.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (haystack[i + j] !== target[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

describe('photoTypeOf', () => {
  it('reads JPEG, PNG and WebP magic bytes and nothing else', () => {
    expect(photoTypeOf(simpleJpeg())).toBe('image/jpeg');
    expect(photoTypeOf(simplePng())).toBe('image/png');
    expect(photoTypeOf(simpleWebp())).toBe('image/webp');
    expect(photoTypeOf(bytesOf('GIF89a'))).toBeNull();
    expect(photoTypeOf(bytesOf('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
    expect(photoTypeOf(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('photoExtension', () => {
  it('names jpg, png and webp', () => {
    expect(photoExtension('image/jpeg')).toBe('jpg');
    expect(photoExtension('image/png')).toBe('png');
    expect(photoExtension('image/webp')).toBe('webp');
  });
});

describe('stripPhotoMetadata JPEG', () => {
  it('keeps a plain JFIF header without thumbnail and an Adobe segment cut to 12 bytes', () => {
    const adobe = bytesOf('Adobe', [0, 100, 0, 0, 0, 0, 1], 'extra private data');
    const result = stripped(
      'image/jpeg',
      jpeg([
        jpegSegment(0xe0, JFIF_WITH_THUMBNAIL),
        jpegSegment(0xee, adobe),
        DQT,
        sof(5, 4),
        scan(),
      ]),
    );
    expect(result).toMatchObject({ width: 5, height: 4 });
    expect(
      contains(
        result.bytes,
        jpegSegment(0xe0, bytesOf(JFIF_WITH_THUMBNAIL.subarray(0, 12), [0, 0])),
      ),
    ).toBe(true);
    expect(contains(result.bytes, jpegSegment(0xee, adobe.subarray(0, 12)))).toBe(true);
    expect(contains(result.bytes, 'extra private data')).toBe(false);
  });

  it('drops JFXX, a short JFIF, another APP0, a short Adobe, other APPn, comments and EXIF without orientation', () => {
    const result = stripped(
      'image/jpeg',
      jpeg([
        jpegSegment(0xe0, bytesOf('JFXX\0', [0x10, 1, 2, 3])),
        jpegSegment(0xe0, bytesOf('JFIF\0', [1, 2, 0])),
        jpegSegment(0xe0, 'OTHER'),
        jpegSegment(0xee, bytesOf('Adobe', [0, 100])),
        jpegSegment(0xee, 'NotAdobe-and-long-enough'),
        jpegSegment(0xe1, bytesOf('Exif\0\0', exifTiff('II', 1))),
        jpegSegment(0xe1, bytesOf('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta GPS/>')),
        jpegSegment(0xe2, bytesOf('ICC_PROFILE\0', 'iPhone camera profile')),
        jpegSegment(0xef, 'maker'),
        jpegSegment(0xfe, 'shot by Alice'),
        DQT,
        sof(2, 1),
        scan(),
      ]),
    );
    for (const text of [
      'JFXX',
      'OTHER',
      'NotAdobe',
      'Exif',
      'xmpmeta',
      'iPhone',
      'maker',
      'Alice',
    ]) {
      expect(contains(result.bytes, text)).toBe(false);
    }
    expect(contains(result.bytes, 'JFIF')).toBe(false);
    expect(contains(result.bytes, 'Adobe')).toBe(false);
  });

  it('writes back a minimal EXIF orientation and swaps width and height for 5 to 8', () => {
    for (const order of ['II', 'MM'] as const) {
      for (const orientation of [6, 8]) {
        const result = stripped(
          'image/jpeg',
          jpeg([
            jpegSegment(0xe1, bytesOf('Exif\0\0', exifTiff(order, orientation, 1))),
            DQT,
            sof(40, 30),
            scan(),
          ]),
        );
        expect(result).toMatchObject({ width: 30, height: 40 });
        expect(contains(result.bytes, bytesOf('Exif\0\0', 'MM', [0, 0x2a]))).toBe(true);
        expect(contains(result.bytes, [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation])).toBe(true);
        expect(contains(result.bytes, 'A')).toBe(false);
      }
    }
  });

  it('keeps width and height for orientation 2 to 4 and only uses the first EXIF segment', () => {
    const result = stripped(
      'image/jpeg',
      jpeg([
        jpegSegment(0xe1, bytesOf('Exif\0\0', exifTiff('MM', 3))),
        jpegSegment(0xe1, bytesOf('Exif\0\0', exifTiff('MM', 6))),
        DQT,
        sof(40, 30),
        scan(),
      ]),
    );
    expect(result).toMatchObject({ width: 40, height: 30 });
    expect(contains(result.bytes, [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 3])).toBe(true);
  });

  it('treats an unreadable or out-of-range orientation as 1', () => {
    for (const tiff of [
      bytesOf('MM'),
      bytesOf('XX', [0, 42, 0, 0, 0, 8]),
      bytesOf('MM', [0, 42, 0, 0, 0, 99]),
      bytesOf('MM', [0, 42, 0, 0, 0, 8], [0, 2], [1, 0x12, 0, 3]),
      exifTiff('MM', 9),
      bytesOf(
        'MM',
        [0, 42, 0, 0, 0, 8],
        [0, 1],
        [1, 0x12, 0, 4, 0, 0, 0, 1, 0, 6, 0, 0],
        [0, 0, 0, 0],
      ),
      bytesOf('MM', [0, 42, 0, 0, 0, 8], [0, 0], [0, 0, 0, 0]),
    ]) {
      const result = stripped(
        'image/jpeg',
        jpeg([jpegSegment(0xe1, bytesOf('Exif\0\0', tiff)), DQT, sof(40, 30), scan()]),
      );
      expect(result).toMatchObject({ width: 40, height: 30 });
      expect(contains(result.bytes, 'Exif')).toBe(false);
    }
  });

  it('keeps the scans of a progressive JPEG, fill bytes, DNL and other markers, and cuts after EOI', () => {
    const result = stripped(
      'image/jpeg',
      jpeg(
        [
          DQT,
          sof(7, 9, 0xc2),
          sof(1, 1, 0xc0),
          jpegSegment(0xc4, new Uint8Array(20)),
          scan(),
          new Uint8Array([0xff]),
          jpegSegment(0xc4, new Uint8Array(20)),
          scan(),
          jpegSegment(0xdc, [0, 9]),
        ],
        [0xff, 0xd8, 0x99, 0x98],
      ),
    );
    expect(result).toMatchObject({ width: 7, height: 9 });
    expect(result.bytes.slice(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
    expect(contains(result.bytes, [0x99, 0x98])).toBe(false);
    expect(contains(result.bytes, [0xff, 0xd3, 0x56])).toBe(true);
  });

  it('keeps only the first JFIF and the first Adobe segment', () => {
    const second = bytesOf(JFIF_WITH_THUMBNAIL.subarray(0, 12), [0, 0]);
    second.set([0x41, 0x42], 7);
    const result = stripped(
      'image/jpeg',
      jpeg([
        jpegSegment(0xe0, JFIF_WITH_THUMBNAIL),
        jpegSegment(0xe0, second),
        jpegSegment(0xee, bytesOf('Adobe', [0, 100, 0, 0, 0, 0, 1])),
        jpegSegment(0xee, 'AdobeXXXXXXX'),
        DQT,
        sof(2, 1),
        scan(),
      ]),
    );
    expect(contains(result.bytes, [0x41, 0x42])).toBe(false);
    expect(contains(result.bytes, 'XXXX')).toBe(false);
    expect(contains(result.bytes, 'Adobe')).toBe(true);
  });

  it('drops JPG, JPGn and reserved markers and keeps DRI', () => {
    const result = stripped(
      'image/jpeg',
      jpeg([
        DQT,
        jpegSegment(0xf0, 'hidden f0'),
        jpegSegment(0xc8, 'hidden c8'),
        jpegSegment(0x02, 'hidden 02'),
        jpegSegment(0xdd, [0, 4]),
        sof(4, 3),
        scan(),
      ]),
    );
    expect(contains(result.bytes, 'hidden')).toBe(false);
    expect(contains(result.bytes, [0xff, 0xdd, 0, 4, 0, 4])).toBe(true);
  });

  it('keeps fill bytes before a restart marker in a scan as one FF', () => {
    const result = stripped(
      'image/jpeg',
      jpeg([
        DQT,
        sof(4, 3),
        bytesOf(scan(), [0x21, 0xff, 0xff, 0xff, 0xd5, 0x22, 0xff, 0xff, 0x00, 0x23]),
      ]),
    );
    expect(result).toMatchObject({ width: 4, height: 3 });
    expect(contains(result.bytes, [0x21, 0xff, 0xd5, 0x22, 0xff, 0x00, 0x23, 0xff, 0xd9])).toBe(
      true,
    );
    expect(contains(result.bytes, [0xff, 0xff])).toBe(false);
  });

  it('drops TEM and a stray restart marker outside a scan', () => {
    const result = stripped(
      'image/jpeg',
      jpeg([DQT, new Uint8Array([0xff, 0x01]), new Uint8Array([0xff, 0xd4]), sof(4, 3), scan()]),
    );
    expect(result).toMatchObject({ width: 4, height: 3 });
    expect(contains(result.bytes, [0xff, 0x01])).toBe(false);
    expect(contains(result.bytes, bytesOf(DQT, sof(4, 3)))).toBe(true);
  });

  it('drops DHP and EXP and rejects a DNL, DRI or DAC of the wrong length', () => {
    const kept = stripped(
      'image/jpeg',
      jpeg([
        DQT,
        jpegSegment(0xde, 'hidden de'),
        jpegSegment(0xdf, 'hidden df'),
        jpegSegment(0xcc, [0, 1]),
        sof(4, 3),
        scan(),
      ]),
    );
    expect(contains(kept.bytes, 'hidden')).toBe(false);
    expect(contains(kept.bytes, [0xff, 0xcc, 0, 4, 0, 1])).toBe(true);
    for (const wrong of [
      jpegSegment(0xdc, 'hidden payload'),
      jpegSegment(0xdd, 'hidden payload'),
      jpegSegment(0xcc, [0, 1, 2]),
    ]) {
      expect(strip('image/jpeg', jpeg([DQT, wrong, sof(4, 3), scan()]))).toEqual({
        ok: false,
        error: 'unreadable',
      });
    }
  });

  it('rejects a broken marker walk', () => {
    const cases = [
      new Uint8Array([0xff, 0xd8]),
      bytesOf([0xff, 0xd8], [0x00, 0x01]),
      bytesOf([0xff, 0xd8], [0xff, 0xff]),
      bytesOf([0xff, 0xd8], [0xff, 0xdb, 0x00]),
      bytesOf([0xff, 0xd8], [0xff, 0xdb, 0x00, 0x01]),
      bytesOf([0xff, 0xd8], [0xff, 0xdb, 0x00, 0x40, 0x00]),
      bytesOf([0xff, 0xd8], jpegSegment(0xc0, [8, 0, 1, 0]), [0xff, 0xd9]),
      bytesOf([0xff, 0xd8], DQT, sof(2, 1), jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]), [1, 2, 3]),
      jpeg([DQT]),
    ];
    for (const bytes of cases) {
      expect(strip('image/jpeg', bytes)).toEqual({ ok: false, error: 'unreadable' });
    }
  });
});

describe('stripPhotoMetadata PNG', () => {
  it('keeps the rendering chunks, drops metadata and cuts after IEND', () => {
    const result = stripped(
      'image/png',
      png(
        [
          ihdr(300, 200),
          pngChunk('sRGB', [0]),
          pngChunk('gAMA', [0, 0, 0xb1, 0x8f]),
          pngChunk('pHYs', new Uint8Array(9)),
          pngChunk('iCCP', 'display profile'),
          pngChunk('eXIf', 'GPS'),
          pngChunk('tEXt', 'Author\0Alice'),
          pngChunk('tIME', new Uint8Array(7)),
          pngChunk('caBX', 'c2pa'),
          pngChunk('IDAT', [1, 2, 3]),
        ],
        [0x50, 0x4b, 0x03, 0x04],
      ),
    );
    expect(result).toMatchObject({ width: 300, height: 200 });
    for (const kept of ['IHDR', 'sRGB', 'gAMA', 'pHYs', 'IDAT', 'IEND']) {
      expect(contains(result.bytes, kept)).toBe(true);
    }
    for (const dropped of ['iCCP', 'eXIf', 'Alice', 'tIME', 'c2pa', 'PK']) {
      expect(contains(result.bytes, dropped)).toBe(false);
    }
  });

  it('rebuilds every kept chunk with a fresh CRC and writes IEND empty', () => {
    const signature = simplePng().subarray(0, 8);
    const result = stripped(
      'image/png',
      bytesOf(
        signature,
        ihdr(2, 2),
        bytesOf([0, 0, 0, 1], 'sRGB', [0], 'XXXX'),
        pngChunk('IDAT', [1, 2, 3]),
        pngChunk('IEND', 'hidden payload'),
      ),
    );
    expect(contains(result.bytes, bytesOf([0, 0, 0, 1], 'sRGB', [0, 0xae, 0xce, 0x1c, 0xe9]))).toBe(
      true,
    );
    expect(result.bytes.slice(-12)).toEqual(
      bytesOf([0, 0, 0, 0], 'IEND', [0xae, 0x42, 0x60, 0x82]),
    );
    expect(contains(result.bytes, 'hidden')).toBe(false);
    expect(contains(result.bytes, 'XXXX')).toBe(false);
    expect(stripped('image/png', simplePng()).bytes).toEqual(simplePng());
  });

  it('drops a fixed-size chunk of another length and an oversized tRNS', () => {
    const result = stripped(
      'image/png',
      png([
        ihdr(2, 2),
        pngChunk('gAMA', 'hide!'),
        pngChunk('sBIT', 'hidden'),
        pngChunk('tRNS', new Uint8Array(257).fill(0x41)),
        pngChunk('bKGD', new Uint8Array(6)),
        pngChunk('IDAT', [1, 2, 3]),
      ]),
    );
    for (const dropped of ['gAMA', 'hide', 'sBIT', 'tRNS']) {
      expect(contains(result.bytes, dropped)).toBe(false);
    }
    expect(contains(result.bytes, 'bKGD')).toBe(true);
  });

  it('keeps a palette and a tRNS that fits the colour type, and rejects a malformed palette', () => {
    const indexed = stripped(
      'image/png',
      png([
        ihdr(2, 2, 3),
        pngChunk('PLTE', [1, 2, 3, 4, 5, 6]),
        pngChunk('tRNS', [0, 0x7f]),
        pngChunk('IDAT', [1]),
      ]),
    );
    expect(contains(indexed.bytes, 'PLTE')).toBe(true);
    expect(contains(indexed.bytes, 'tRNS')).toBe(true);
    for (const [colourType, trns, kept] of [
      [3, [0, 0, 0], false],
      [0, [0, 1], true],
      [0, [0, 1, 2], false],
      [2, new Uint8Array(6), true],
      [2, [0, 1], false],
      [6, [0, 1], false],
      [6, [], false],
    ] as const) {
      const result = stripped(
        'image/png',
        png([
          ihdr(2, 2, colourType),
          pngChunk('PLTE', [1, 2, 3, 4, 5, 6]),
          pngChunk('tRNS', trns),
          pngChunk('IDAT', [1]),
        ]),
      );
      expect(contains(result.bytes, 'tRNS')).toBe(kept);
    }
    for (const palette of [[1, 2], [1, 2, 3, 4], new Uint8Array(771)]) {
      expect(
        strip('image/png', png([ihdr(2, 2), pngChunk('PLTE', palette), pngChunk('IDAT', [1])])),
      ).toEqual({ ok: false, error: 'unreadable' });
    }
  });

  it('keeps PLTE only for an indexed image and checks it against the bit depth', () => {
    const rgb = stripped(
      'image/png',
      png([ihdr(2, 2), pngChunk('PLTE', 'hidden'), pngChunk('IDAT', [1])]),
    );
    expect(contains(rgb.bytes, 'PLTE')).toBe(false);
    const tooMany = png([
      pngChunk('IHDR', bytesOf([0, 0, 0, 2, 0, 0, 0, 2], [1, 3, 0, 0, 0])),
      pngChunk('PLTE', new Uint8Array(9)),
      pngChunk('IDAT', [1]),
    ]);
    expect(strip('image/png', tooMany)).toEqual({ ok: false, error: 'unreadable' });
  });

  it('keeps an indexed bKGD only when it names a palette entry', () => {
    for (const [index, kept] of [
      [1, true],
      [2, false],
    ] as const) {
      const result = stripped(
        'image/png',
        png([
          ihdr(2, 2, 3),
          pngChunk('PLTE', [1, 2, 3, 4, 5, 6]),
          pngChunk('bKGD', [index]),
          pngChunk('IDAT', [1]),
        ]),
      );
      expect(contains(result.bytes, 'bKGD')).toBe(kept);
    }
  });

  it('checks sBIT and bKGD against the colour type', () => {
    for (const [colourType, sbit, bkgd, kept] of [
      [0, [8], [0, 1], true],
      [0, [8, 8, 8, 8], new Uint8Array(6), false],
      [2, [8, 8, 8], new Uint8Array(6), true],
      [2, [8], [0], false],
      [4, [8, 8], [0, 1], true],
      [6, [8, 8, 8, 8], new Uint8Array(6), true],
    ] as const) {
      const result = stripped(
        'image/png',
        png([
          ihdr(2, 2, colourType),
          pngChunk('sBIT', sbit),
          pngChunk('bKGD', bkgd),
          pngChunk('IDAT', [1]),
        ]),
      );
      expect(contains(result.bytes, 'sBIT')).toBe(kept);
      expect(contains(result.bytes, 'bKGD')).toBe(kept);
    }
  });

  it('keeps each ancillary chunk once and only before the image data, and every IDAT', () => {
    const result = stripped(
      'image/png',
      png([
        ihdr(2, 2),
        pngChunk('gAMA', [0, 0, 0, 1]),
        pngChunk('gAMA', [0, 0, 0, 2]),
        pngChunk('IDAT', [1]),
        pngChunk('IDAT', [2]),
        pngChunk('pHYs', new Uint8Array(9)),
        pngChunk('PLTE', [1, 2, 3]),
      ]),
    );
    expect(contains(result.bytes, bytesOf('gAMA', [0, 0, 0, 1]))).toBe(true);
    expect(contains(result.bytes, bytesOf('gAMA', [0, 0, 0, 2]))).toBe(false);
    expect(contains(result.bytes, bytesOf('IDAT', [2]))).toBe(true);
    for (const dropped of ['pHYs', 'PLTE']) {
      expect(contains(result.bytes, dropped)).toBe(false);
    }
  });

  it('skips an animated PNG', () => {
    expect(strip('image/png', png([ihdr(2, 2), pngChunk('acTL', new Uint8Array(8))]))).toEqual({
      ok: false,
      error: 'animated',
    });
  });

  it('rejects a broken chunk walk', () => {
    const signature = simplePng().subarray(0, 8);
    for (const bytes of [
      signature,
      bytesOf(signature, [0, 0, 0, 13], 'IHDR', new Uint8Array(13)),
      bytesOf(signature, pngChunk('IDAT', [1])),
      bytesOf(signature, pngChunk('IHDR', new Uint8Array(12))),
      bytesOf(signature, ihdr(2, 2), pngChunk('IDAT', [1])),
      png([ihdr(2, 2), pngChunk('IHDR', 'hidden'), pngChunk('IDAT', [1])]),
      png([ihdr(2, 2), pngChunk('gAMA', [0, 0, 0, 1])]),
    ]) {
      expect(strip('image/png', bytes)).toEqual({ ok: false, error: 'unreadable' });
    }
  });
});

describe('stripPhotoMetadata WebP', () => {
  it('keeps a lossy image and cuts bytes after the RIFF end', () => {
    const result = stripped('image/webp', webp([webpChunk('VP8 ', vp8(640, 480))], [9, 9, 9]));
    expect(result).toMatchObject({ width: 640, height: 480 });
    expect(result.bytes.length).toBe(12 + 8 + 12);
    expect(Buffer.from(result.bytes).readUInt32LE(4)).toBe(result.bytes.length - 8);
  });

  it('keeps a lossless image with an odd-sized chunk and its pad byte', () => {
    const result = stripped('image/webp', webp([webpChunk('VP8L', vp8l(33, 17))]));
    expect(result).toMatchObject({ width: 33, height: 17 });
    expect(result.bytes.length % 2).toBe(0);
  });

  it('keeps only the alpha flag of VP8X and zeroes its reserved bytes', () => {
    const header = vp8x(0xc0 | 0x10 | 0x01, 10, 10);
    header.set([7, 7, 7], 1);
    const result = stripped(
      'image/webp',
      webp([webpChunk('VP8X', header), webpChunk('VP8 ', vp8(10, 10))]),
    );
    expect(result.bytes.subarray(20, 24)).toEqual(new Uint8Array([0x10, 0, 0, 0]));
  });

  it('writes the pad byte of an odd-sized chunk as zero', () => {
    const body = vp8l(33, 17);
    const result = stripped(
      'image/webp',
      webp([bytesOf('VP8L', [body.length, 0, 0, 0], body, [0x41])]),
    );
    expect(result.bytes[result.bytes.length - 1]).toBe(0);
    expect(contains(result.bytes, [0x41])).toBe(false);
  });

  it('drops EXIF, XMP and ICCP, clears their VP8X flags and returns the frame size', () => {
    const result = stripped(
      'image/webp',
      webp([
        webpChunk('VP8X', vp8x(0x20 | 0x10 | 0x08 | 0x04, 1000, 750)),
        webpChunk('ICCP', 'camera profile'),
        webpChunk('ALPH', [1, 2, 3]),
        webpChunk('VP8 ', vp8(1000, 750)),
        webpChunk('VP8 ', vp8(5, 5)),
        webpChunk('EXIF', 'GPS 47.3'),
        webpChunk('XMP ', '<xmp/>'),
      ]),
    );
    expect(result).toMatchObject({ width: 1000, height: 750 });
    for (const dropped of ['ICCP', 'camera', 'EXIF', 'GPS', 'XMP ', 'xmp']) {
      expect(contains(result.bytes, dropped)).toBe(false);
    }
    expect(result.bytes[20]).toBe(0x10);
    expect(Buffer.from(result.bytes).readUInt32LE(4)).toBe(result.bytes.length - 8);
  });

  it('uses the first frame chunk only', () => {
    const result = stripped(
      'image/webp',
      webp([webpChunk('VP8L', vp8l(8, 8)), webpChunk('VP8L', vp8l(2, 2))]),
    );
    expect(result).toMatchObject({ width: 8, height: 8 });
    expect(result.bytes).toEqual(webp([webpChunk('VP8L', vp8l(8, 8))]));
  });

  it('keeps one ALPH only after VP8X and before the frame', () => {
    const simple = stripped(
      'image/webp',
      webp([webpChunk('ALPH', 'hidden'), webpChunk('VP8 ', vp8(10, 10))]),
    );
    expect(contains(simple.bytes, 'ALPH')).toBe(false);
    const extended = stripped(
      'image/webp',
      webp([
        webpChunk('VP8X', vp8x(0x10, 10, 10)),
        webpChunk('ALPH', [1]),
        webpChunk('ALPH', 'hidden'),
        webpChunk('VP8 ', vp8(10, 10)),
        webpChunk('ALPH', 'later'),
      ]),
    );
    expect(contains(extended.bytes, bytesOf('ALPH', [1, 0, 0, 0, 1]))).toBe(true);
    expect(contains(extended.bytes, 'hidden')).toBe(false);
    expect(contains(extended.bytes, 'later')).toBe(false);
    const lossless = stripped(
      'image/webp',
      webp([
        webpChunk('VP8X', vp8x(0x10, 8, 8)),
        webpChunk('ALPH', 'hidden'),
        webpChunk('VP8L', vp8l(8, 8)),
      ]),
    );
    expect(contains(lossless.bytes, 'ALPH')).toBe(false);
  });

  it('rejects a VP8X canvas that differs from the frame size', () => {
    for (const frame of [
      webpChunk('VP8 ', vp8(16383, 16383)),
      webpChunk('VP8L', vp8l(16384, 16384)),
      webpChunk('VP8 ', vp8(2, 1)),
      webpChunk('VP8L', vp8l(1, 2)),
    ]) {
      expect(strip('image/webp', webp([webpChunk('VP8X', vp8x(0, 1, 1)), frame]))).toEqual({
        ok: false,
        error: 'unreadable',
      });
    }
    const lossy = stripped(
      'image/webp',
      webp([webpChunk('VP8X', vp8x(0, 4096, 4096)), webpChunk('VP8 ', vp8(4096, 4096))]),
    );
    expect(lossy).toMatchObject({ width: 4096, height: 4096 });
    const lossless = stripped(
      'image/webp',
      webp([webpChunk('VP8X', vp8x(0x10, 33, 17)), webpChunk('VP8L', vp8l(33, 17))]),
    );
    expect(lossless).toMatchObject({ width: 33, height: 17 });
  });

  it('skips an animated WebP', () => {
    for (const chunks of [
      [webpChunk('VP8X', vp8x(0x02, 10, 10)), webpChunk('VP8 ', vp8(10, 10))],
      [webpChunk('ANIM', new Uint8Array(6))],
      [webpChunk('ANMF', new Uint8Array(16))],
    ]) {
      expect(strip('image/webp', webp(chunks))).toEqual({ ok: false, error: 'animated' });
    }
  });

  it('rejects a broken chunk walk or a missing frame', () => {
    const vp8Body = vp8(10, 10);
    const broken = [
      bytesOf('RIFF', [4, 0, 0, 0], 'WEB'),
      bytesOf('RIFF', [200, 0, 0, 0], 'WEBP', webpChunk('VP8 ', vp8Body)),
      bytesOf('RIFF', [8, 0, 0, 0], 'WEBP', 'VP8 '),
      webp([bytesOf('VP8 ', [40, 0, 0, 0], vp8Body)]),
      webp([webpChunk('VP8X', new Uint8Array(6))]),
      webp([webpChunk('VP8X', bytesOf(vp8x(0, 10, 10), 'hidden')), webpChunk('VP8 ', vp8Body)]),
      webp([webpChunk('VP8 ', vp8Body), webpChunk('VP8X', vp8x(0, 10, 10))]),
      webp([webpChunk('VP8 ', new Uint8Array(10))]),
      webp([webpChunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a])]),
      webp([webpChunk('VP8L', [0x2f, 0, 0])]),
      webp([webpChunk('VP8L', [0x00, 0, 0, 0, 0])]),
      webp([webpChunk('ALPH', [1, 2])]),
    ];
    for (const bytes of broken) {
      expect(strip('image/webp', bytes)).toEqual({ ok: false, error: 'unreadable' });
    }
  });
});
