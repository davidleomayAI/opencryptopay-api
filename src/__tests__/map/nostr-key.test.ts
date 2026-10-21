import { describe, expect, it } from 'vitest';
import { isNostrPubkey, npubDecode, npubEncode } from '@/lib/map/nostr-key';

/** NIP-19 test vector. */
const HEX = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (const [i, generator] of GENERATOR.entries()) {
      if (((top >>> i) & 1) === 1) {
        chk ^= generator;
      }
    }
  }
  return chk;
}

/** An npub with a valid checksum over the given 52 data words. */
function npubWithWords(words: number[]): string {
  const hrp = [3, 3, 3, 3, 0, 14, 16, 21, 2];
  const mod = polymod([...hrp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `npub1${[...words, ...checksum].map((word) => CHARSET[word]).join('')}`;
}

describe('isNostrPubkey', () => {
  it('accepts a key on secp256k1', () => {
    expect(isNostrPubkey(HEX)).toBe(true);
  });

  it('rejects a non-string, a wrong length, uppercase hex and an npub', () => {
    expect(isNostrPubkey(42)).toBe(false);
    expect(isNostrPubkey(HEX.slice(1))).toBe(false);
    expect(isNostrPubkey(`${HEX}0`)).toBe(false);
    expect(isNostrPubkey(HEX.toUpperCase())).toBe(false);
    expect(isNostrPubkey(NPUB)).toBe(false);
  });

  it('rejects x at or above the field prime and an x that is not on the curve', () => {
    expect(isNostrPubkey('f'.repeat(64))).toBe(false);
    expect(isNostrPubkey('0'.repeat(64))).toBe(false);
  });
});

describe('npubEncode', () => {
  it('matches the NIP-19 test vector', () => {
    expect(npubEncode(HEX)).toBe(NPUB);
  });
});

describe('npubDecode', () => {
  it('returns the key of the NIP-19 test vector and round-trips', () => {
    expect(npubDecode(NPUB)).toBe(HEX);
    expect(npubDecode(npubEncode(HEX))).toBe(HEX);
  });

  it('rejects a wrong prefix, length or character', () => {
    expect(npubDecode(NPUB.toUpperCase())).toBeNull();
    expect(npubDecode(`nsec${NPUB.slice(4)}`)).toBeNull();
    expect(npubDecode(NPUB.slice(0, -1))).toBeNull();
    expect(npubDecode(`${NPUB.slice(0, -1)}b`)).toBeNull();
  });

  it('rejects a wrong checksum', () => {
    const last = NPUB.slice(-1) === 'q' ? 'p' : 'q';
    expect(npubDecode(`${NPUB.slice(0, -1)}${last}`)).toBeNull();
  });

  it('rejects padding bits that are not zero', () => {
    const words = [...NPUB.slice(5, -6)].map((char) => CHARSET.indexOf(char));
    words[words.length - 1] = (words[words.length - 1] ?? 0) | 1;
    const padded = npubWithWords(words);
    expect(padded).toMatch(/^npub1[02-9ac-hj-np-z]{58}$/u);
    expect(npubDecode(padded)).toBeNull();
  });
});
