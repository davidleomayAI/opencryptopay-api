import { createHash } from 'node:crypto';
import { isNostrPubkey } from '@/lib/map/nostr-key';
import type { MapPlaceInput, StoredMapPlace } from '@/lib/map/place';
import type { MapPlaceDeleteResult, MapPlaceStore, MapPlaceWriteResult } from '@/lib/map/store';

/**
 * A valid NIP-01 key derived from a label, so each test row gets its own.
 *
 * @param label - Any text; the same label always gives the same key.
 * @returns 64 lowercase hex characters on secp256k1.
 */
export function keyFor(label: string): string {
  for (let round = 0; ; round += 1) {
    const candidate = createHash('sha256')
      .update(`${label}:${String(round)}`)
      .digest('hex');
    if (isNostrPubkey(candidate)) {
      return candidate;
    }
  }
}

/**
 * The input with a key derived from its origin and external id, unless it has one.
 *
 * @param input - Validated pin.
 * @returns The pin with `nostrPubkey` set.
 */
export function withKey(input: MapPlaceInput): MapPlaceInput {
  if (input.nostrPubkey !== undefined) {
    return input;
  }
  return { ...input, nostrPubkey: keyFor(`${input.origin}\n${input.externalId}`) };
}

function written(result: MapPlaceWriteResult): { created: boolean; place: StoredMapPlace } {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return { created: result.created, place: result.place };
}

function deleted(result: MapPlaceDeleteResult): boolean {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.deleted;
}

/**
 * A store whose writes add a derived key and return the pre-R7 shapes, for tests
 * that check behaviour unrelated to the key and the revision.
 *
 * @param store - Store under test.
 * @returns The same store with key-adding, unwrapping writes.
 */
export function keyedStore<T extends MapPlaceStore>(store: T) {
  return {
    insertIfNew: (input: MapPlaceInput) => written(store.insertIfNew(withKey(input))),
    upsert: (input: MapPlaceInput) => written(store.upsert(withKey(input))),
    deleteByKey: (origin: string, externalId: string) =>
      deleted(store.deleteByKey(origin, externalId)),
    recordTransaction: (origin: string, externalId: string, occurredAt: string, nowMs: number) =>
      store.recordTransaction(origin, externalId, occurredAt, nowMs),
    refreshActivity: (nowMs: number) => store.refreshActivity(nowMs),
    list: (...args: Parameters<MapPlaceStore['list']>) => store.list(...args),
    listAll: () => store.listAll(),
    filters: (blockchain?: string) => store.filters(blockchain),
    findPublicByPubkey: (pubkey: string) => store.findPublicByPubkey(pubkey),
    close: () => store.close(),
  };
}
