/**
 * NOSTR public keys as shop ids: the x-only secp256k1 key from NIP-01 and its
 * NIP-19 `npub` form. Nothing here holds or derives a private key.
 */

/** 64 lowercase hex characters. */
const HEX_KEY = /^[0-9a-f]{64}$/u;

/** `npub1` plus 58 bech32 characters: 52 data characters and a 6-character checksum. */
const NPUB = /^npub1[02-9ac-hj-np-z]{58}$/u;

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const NPUB_PREFIX = 'npub';

/** Field prime of secp256k1. */
const CURVE_P = 2n ** 256n - 2n ** 32n - 977n;

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * Whether a value is a NIP-01 public key: 64 lowercase hex characters naming the
 * x coordinate of a point on secp256k1.
 *
 * @param value - Any JSON value.
 * @returns True when `x < p` and `x³ + 7` is a square modulo `p` (Euler's criterion).
 */
export function isNostrPubkey(value: unknown): value is string {
  if (typeof value !== 'string' || !HEX_KEY.test(value)) {
    return false;
  }
  const x = BigInt(`0x${value}`);
  if (x >= CURVE_P) {
    return false;
  }
  const rhs = (modPow(x, 3n, CURVE_P) + 7n) % CURVE_P;
  return modPow(rhs, (CURVE_P - 1n) / 2n, CURVE_P) === 1n;
}

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (const [i, generator] of BECH32_GENERATOR.entries()) {
      if (((top >>> i) & 1) === 1) {
        chk ^= generator;
      }
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const high = [...hrp].map((char) => char.charCodeAt(0) >>> 5);
  const low = [...hrp].map((char) => char.charCodeAt(0) & 31);
  return [...high, 0, ...low];
}

/** 32 bytes to 52 five-bit words, the last word padded with zero bits. */
function bytesToWords(bytes: number[]): number[] {
  let acc = 0;
  let bits = 0;
  const words: number[] = [];
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  words.push((acc << (5 - bits)) & 31);
  return words;
}

/** 52 five-bit words to 32 bytes; null when the 4 padding bits are not zero. */
function wordsToBytes(words: number[]): number[] | null {
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const word of words) {
    acc = ((acc << 5) | word) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
  }
  return (acc & ((1 << bits) - 1)) === 0 ? bytes : null;
}

/**
 * NIP-19 `npub` for a public key.
 *
 * @param pubkey - 64 lowercase hex characters, as accepted by {@link isNostrPubkey}.
 * @returns The bech32 string with prefix `npub`, 63 characters.
 */
export function npubEncode(pubkey: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < pubkey.length; i += 2) {
    bytes.push(Number.parseInt(pubkey.slice(i, i + 2), 16));
  }
  const words = bytesToWords(bytes);
  const mod = polymod([...hrpExpand(NPUB_PREFIX), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${NPUB_PREFIX}1${[...words, ...checksum].map((word) => BECH32_CHARSET[word]).join('')}`;
}

/**
 * Public key named by an `npub`.
 *
 * @param npub - Lowercase `npub1…` string of 63 characters.
 * @returns 64 lowercase hex characters, or null when the form, the checksum or the
 * padding is wrong.
 */
export function npubDecode(npub: string): string | null {
  if (!NPUB.test(npub)) {
    return null;
  }
  const words = [...npub.slice(NPUB_PREFIX.length + 1)].map((char) => BECH32_CHARSET.indexOf(char));
  if (polymod([...hrpExpand(NPUB_PREFIX), ...words]) !== 1) {
    return null;
  }
  const bytes = wordsToBytes(words.slice(0, -6));
  if (bytes === null) {
    return null;
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
