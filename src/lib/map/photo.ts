/**
 * Shop photos sent by a source through `PUT /map/places/photos`.
 */

import { createHash } from 'node:crypto';
import { isNostrPubkey } from '@/lib/map/nostr-key';
import { normalizePlaceOrigin } from '@/lib/map/place';
import { photoTypeOf, stripPhotoMetadata, type PhotoType } from '@/lib/map/photo-strip';

/** At most this many photos per shop. */
export const MAX_PHOTOS = 10;

/** Largest decoded photo, in bytes. */
export const MAX_PHOTO_BYTES = 1_048_576;

/** Largest request body of `PUT /map/places/photos`, in bytes. */
export const MAX_PHOTO_BODY_BYTES = 15 * 1_048_576;

/** Largest stored width or height, in pixels. */
const MAX_SIDE = 4096;

const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
/** Whether a caption has a control character (C0, DEL or C1). */
function hasControl(value: string): boolean {
  return [...value].some((char) => {
    const code = char.codePointAt(0) as number;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

const TOP_KEYS: ReadonlySet<string> = new Set(['origin', 'nostrPubkey', 'revision', 'photos']);
const PHOTO_KEYS: ReadonlySet<string> = new Set(['contentType', 'data', 'caption']);
const PHOTO_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** A photo after metadata removal, ready to store. */
export type PreparedPhoto = {
  sha256: string;
  contentType: PhotoType;
  width: number;
  height: number;
  data: Uint8Array;
  caption: string | null;
};

/** A validated upload envelope. Each photo is checked on its own by {@link preparePhoto}. */
export type PhotoUpload = {
  origin: string;
  nostrPubkey: string;
  revision: number | undefined;
  photos: Array<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the envelope of a `PUT /map/places/photos` body. A malformed
 * envelope is rejected as a whole; single photos are checked later.
 *
 * @param input - Request JSON.
 * @returns The envelope, or a fixed error message for a 400.
 */
export function normalizePhotoUpload(
  input: unknown,
): { ok: true; value: PhotoUpload } | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: 'Photo upload is invalid' };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.has(key)) {
      return { ok: false, error: `Photo upload field is not allowed: ${key.slice(0, 40)}` };
    }
  }
  const origin = normalizePlaceOrigin(input['origin']);
  if (!origin.ok) {
    return origin;
  }
  const nostrPubkey = input['nostrPubkey'];
  if (!isNostrPubkey(nostrPubkey)) {
    return { ok: false, error: 'Place NOSTR public key is invalid' };
  }
  const revision = input['revision'];
  if (
    revision !== undefined &&
    (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
  ) {
    return { ok: false, error: 'Place revision is invalid' };
  }
  const photos = input['photos'];
  if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) {
    return { ok: false, error: `Photos must be a list of at most ${String(MAX_PHOTOS)}` };
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const entry of photos as unknown[]) {
    if (!isRecord(entry)) {
      return { ok: false, error: 'Photo entry must be an object' };
    }
    for (const key of Object.keys(entry)) {
      if (!PHOTO_KEYS.has(key)) {
        return { ok: false, error: `Photo field is not allowed: ${key.slice(0, 40)}` };
      }
    }
    entries.push(entry);
  }
  return {
    ok: true,
    value: {
      origin: origin.value,
      nostrPubkey,
      revision: revision === undefined ? undefined : revision,
      photos: entries,
    },
  };
}

/**
 * Check one photo, remove its metadata and hash the stripped bytes.
 *
 * @param entry - One validated photo entry.
 * @param index - 0-based position in the request; the error sentence counts from 1.
 * @returns The prepared photo, or the sentence reported in `skipped`.
 */
export function preparePhoto(
  entry: Record<string, unknown>,
  index: number,
): { ok: true; photo: PreparedPhoto } | { ok: false; error: string } {
  const label = `Photo ${String(index + 1)}`;
  const contentType = entry['contentType'];
  if (typeof contentType !== 'string' || !PHOTO_TYPES.has(contentType)) {
    return { ok: false, error: `${label} is not a JPEG, PNG or WebP image` };
  }
  const data = entry['data'];
  if (typeof data !== 'string' || !STRICT_BASE64.test(data)) {
    return { ok: false, error: `${label} is not valid base64` };
  }
  if ((data.length / 4) * 3 - (data.match(/=/gu)?.length ?? 0) > MAX_PHOTO_BYTES) {
    return { ok: false, error: `${label} is larger than 1 MiB` };
  }
  const caption = entry['caption'];
  if (
    caption !== undefined &&
    (typeof caption !== 'string' ||
      caption.length < 1 ||
      caption.length > 200 ||
      hasControl(caption))
  ) {
    return { ok: false, error: `${label} caption is invalid` };
  }
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  if (photoTypeOf(bytes) !== contentType) {
    return { ok: false, error: `${label} does not match its content type` };
  }
  const stripped = stripPhotoMetadata(contentType as PhotoType, bytes);
  if (!stripped.ok) {
    return {
      ok: false,
      error: stripped.error === 'animated' ? `${label} is animated` : `${label} could not be read`,
    };
  }
  if (
    stripped.width < 1 ||
    stripped.height < 1 ||
    stripped.width > MAX_SIDE ||
    stripped.height > MAX_SIDE
  ) {
    return { ok: false, error: `${label} must be 1 to 4096 pixels wide and high` };
  }
  return {
    ok: true,
    photo: {
      sha256: createHash('sha256').update(stripped.bytes).digest('hex'),
      contentType: contentType as PhotoType,
      width: stripped.width,
      height: stripped.height,
      data: stripped.bytes,
      caption: caption === undefined ? null : caption,
    },
  };
}

/**
 * Validate `OCP_PUBLIC_BASE_URL`: an `https://` origin without a path, query,
 * credentials or trailing slash. Photo URLs are built from it, never from the
 * request's `Host` header.
 *
 * @param raw - Environment value.
 * @returns The origin, or null when the value is missing or not such an origin.
 */
export function parsePublicBaseUrl(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.origin === raw ? raw : null;
}
