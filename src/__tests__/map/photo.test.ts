import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_PHOTOS,
  normalizePhotoUpload,
  parsePublicBaseUrl,
  preparePhoto,
} from '@/lib/map/photo';
import {
  base64,
  bytesOf,
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
} from './photo-fixtures';
import { keyFor } from './keys';

const KEY = keyFor('photo-test');

const envelope = { origin: '21gifts', nostrPubkey: KEY, revision: 3, photos: [] as unknown[] };

describe('normalizePhotoUpload', () => {
  it('accepts origin, key, an optional revision and up to 10 photo objects', () => {
    const photo = { contentType: 'image/jpeg', data: 'AAAA', caption: 'Front' };
    expect(
      normalizePhotoUpload({
        ...envelope,
        photos: Array.from({ length: MAX_PHOTOS }, () => photo),
      }),
    ).toEqual({
      ok: true,
      value: {
        origin: '21gifts',
        nostrPubkey: KEY,
        revision: 3,
        photos: Array.from({ length: MAX_PHOTOS }, () => photo),
      },
    });
    const withoutRevision = normalizePhotoUpload({ origin: 'dfx', nostrPubkey: KEY, photos: [] });
    expect(withoutRevision.ok && withoutRevision.value.revision).toBeUndefined();
  });

  it('rejects a malformed envelope', () => {
    const cases: Array<[unknown, string]> = [
      [null, 'Photo upload is invalid'],
      [[], 'Photo upload is invalid'],
      [{ ...envelope, name: 'x' }, 'Photo upload field is not allowed: name'],
      [{ ...envelope, origin: 'SPAR' }, 'Place origin is invalid'],
      [{ ...envelope, nostrPubkey: undefined }, 'Place NOSTR public key is invalid'],
      [{ ...envelope, nostrPubkey: KEY.toUpperCase() }, 'Place NOSTR public key is invalid'],
      [{ ...envelope, revision: 0 }, 'Place revision is invalid'],
      [{ ...envelope, revision: '3' }, 'Place revision is invalid'],
      [{ ...envelope, revision: 1.5 }, 'Place revision is invalid'],
      [{ ...envelope, photos: 'x' }, 'Photos must be a list of at most 10'],
      [{ ...envelope, photos: new Array(11).fill({}) }, 'Photos must be a list of at most 10'],
      [{ ...envelope, photos: [[]] }, 'Photo entry must be an object'],
      [{ ...envelope, photos: [null] }, 'Photo entry must be an object'],
      [
        { ...envelope, photos: [{ contentType: 'image/png', size: 1 }] },
        'Photo field is not allowed: size',
      ],
    ];
    for (const [input, error] of cases) {
      expect(normalizePhotoUpload(input)).toEqual({ ok: false, error });
    }
  });
});

describe('preparePhoto', () => {
  it('strips, sizes and hashes a JPEG, PNG and WebP photo', () => {
    for (const [contentType, bytes, width, height] of [
      ['image/jpeg', simpleJpeg(2, 1), 2, 1],
      ['image/png', simplePng(3, 2), 3, 2],
      ['image/webp', simpleWebp(4, 3), 4, 3],
    ] as const) {
      const result = preparePhoto({ contentType, data: base64(bytes), caption: 'Front' }, 0);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.photo).toMatchObject({ contentType, width, height, caption: 'Front' });
        expect(result.photo.sha256).toBe(
          createHash('sha256').update(result.photo.data).digest('hex'),
        );
      }
    }
    const plain = preparePhoto({ contentType: 'image/png', data: base64(simplePng()) }, 0);
    expect(plain.ok && plain.photo.caption).toBeNull();
    const accented = preparePhoto(
      { contentType: 'image/png', data: base64(simplePng()), caption: 'Café Zürich' },
      0,
    );
    expect(accented.ok && accented.photo.caption).toBe('Café Zürich');
  });

  it('hashes the stripped bytes, so metadata does not change the hash', () => {
    const withText = png([
      ihdr(3, 2),
      pngChunk('tEXt', 'Author\0Alice'),
      pngChunk('IDAT', [1, 2, 3]),
    ]);
    const a = preparePhoto({ contentType: 'image/png', data: base64(withText) }, 0);
    const b = preparePhoto({ contentType: 'image/png', data: base64(simplePng(3, 2)) }, 0);
    expect(a.ok && b.ok && a.photo.sha256 === b.photo.sha256).toBe(true);
  });

  it('numbers the photo from 1 in every error sentence', () => {
    const big = new Uint8Array(1_048_577);
    big.set(simpleJpeg());
    const animated = png([ihdr(2, 2), pngChunk('acTL', new Uint8Array(8))]);
    const tooWide = jpeg([jpegSegment(0xdb, new Uint8Array(65)), sof(4097, 1), scan()]);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ data: base64(simplePng()) }, 'Photo 3 is not a JPEG, PNG or WebP image'],
      [{ contentType: 'image/gif', data: 'R0lG' }, 'Photo 3 is not a JPEG, PNG or WebP image'],
      [{ contentType: 'image/png' }, 'Photo 3 is not valid base64'],
      [{ contentType: 'image/png', data: 'not base64!' }, 'Photo 3 is not valid base64'],
      [{ contentType: 'image/png', data: 'AAA' }, 'Photo 3 is not valid base64'],
      [{ contentType: 'image/png', data: 5 }, 'Photo 3 is not valid base64'],
      [{ contentType: 'image/jpeg', data: base64(big) }, 'Photo 3 is larger than 1 MiB'],
      [
        { contentType: 'image/png', data: base64(simplePng()), caption: '' },
        'Photo 3 caption is invalid',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng()), caption: 'x'.repeat(201) },
        'Photo 3 caption is invalid',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng()), caption: 'a\nb' },
        'Photo 3 caption is invalid',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng()), caption: 7 },
        'Photo 3 caption is invalid',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng()), caption: 'a\u0085b' },
        'Photo 3 caption is invalid',
      ],
      [
        { contentType: 'image/png', data: base64(simpleJpeg()) },
        'Photo 3 does not match its content type',
      ],
      [
        { contentType: 'image/png', data: base64(bytesOf('GIF89a')) },
        'Photo 3 does not match its content type',
      ],
      [{ contentType: 'image/png', data: base64(animated) }, 'Photo 3 is animated'],
      [
        { contentType: 'image/png', data: base64(simplePng().subarray(0, 20)) },
        'Photo 3 could not be read',
      ],
      [
        { contentType: 'image/jpeg', data: base64(tooWide) },
        'Photo 3 must be 1 to 4096 pixels wide and high',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng(0, 2)) },
        'Photo 3 must be 1 to 4096 pixels wide and high',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng(2, 0)) },
        'Photo 3 must be 1 to 4096 pixels wide and high',
      ],
      [
        { contentType: 'image/png', data: base64(simplePng(2, 4097)) },
        'Photo 3 must be 1 to 4096 pixels wide and high',
      ],
    ];
    for (const [entry, error] of cases) {
      expect(preparePhoto(entry, 2)).toEqual({ ok: false, error });
    }
  });

  it('accepts exactly 1 MiB and a 200-character caption', () => {
    const exact = new Uint8Array(1_048_576);
    exact.set(simpleJpeg());
    const result = preparePhoto(
      { contentType: 'image/jpeg', data: base64(simpleJpeg()), caption: 'x'.repeat(200) },
      0,
    );
    expect(result.ok).toBe(true);
    const atLimit = preparePhoto({ contentType: 'image/jpeg', data: base64(exact) }, 0);
    expect(atLimit.ok && atLimit.photo.width).toBe(2);
  });
});

describe('parsePublicBaseUrl', () => {
  it('accepts an https origin without a trailing slash', () => {
    expect(parsePublicBaseUrl('https://api.opencryptopay.io')).toBe('https://api.opencryptopay.io');
    expect(parsePublicBaseUrl('https://dev-api.opencryptopay.io:8443')).toBe(
      'https://dev-api.opencryptopay.io:8443',
    );
  });

  it('rejects anything else', () => {
    for (const raw of [
      undefined,
      '',
      'api.opencryptopay.io',
      'http://api.opencryptopay.io',
      'https://api.opencryptopay.io/',
      'https://api.opencryptopay.io/map',
      'https://user@api.opencryptopay.io',
      'https://API.opencryptopay.io',
    ]) {
      expect(parsePublicBaseUrl(raw)).toBeNull();
    }
  });
});
