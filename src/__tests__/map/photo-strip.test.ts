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

  it('drops EXIF, XMP and ICCP, clears their VP8X flags and takes the canvas size', () => {
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
