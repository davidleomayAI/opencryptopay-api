import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pushMapPlace, type FetchLike, type MapPushResult } from '@/lib/map/btcmap';
import { publicFilterResponse } from '@/lib/map/filter-catalog';
import {
  normalizeMapPlace,
  normalizeMapPlaceFilter,
  normalizeMapPlaceKey,
  normalizePlaceOrigin,
  normalizePlaceTransaction,
  toPublicMapPlace,
} from '@/lib/map/place';
import { sparPaymentLinkAddressUpdates } from '@/lib/map/spar-address';
import type { MapPlaceListFilter, MapPlaceStore } from '@/lib/map/store';

const DEFAULT_SPAR_LOCATIONS_URL = 'https://api.dfx.swiss/v1/paymentLink/locations?publicName=SPAR';
const SPAR_LOCATIONS_CACHE_MS = 10 * 60 * 1000;
const SPAR_LOCATIONS_TIMEOUT_MS = 3_000;
const SPAR_LOCATIONS_BODY_MAX = 1_000_000;
const SPAR_PAYMENT_LINK_NAME = 'SPAR';

function sparLocationsUrl(env: Record<string, string | undefined>): string | undefined {
  const raw = env['DFX_SPAR_LOCATIONS_URL'];
  if (raw === undefined) {
    return DEFAULT_SPAR_LOCATIONS_URL;
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'off') {
    return undefined;
  }
  return trimmed;
}

export type MapRouteDeps = {
  store: MapPlaceStore;
  /** Ingest bearer. Unset or blank means ingest is not configured. */
  ingestToken?: string;
  env: Record<string, string | undefined>;
  fetchImpl: FetchLike;
  now?: () => number;
};

function checkIngest(
  configured: string | undefined,
  authorization: string | undefined,
): 'unconfigured' | 'unauthorized' | 'ok' {
  if (configured === undefined || configured.trim() === '') {
    return 'unconfigured';
  }
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    return 'unauthorized';
  }
  const presented = authorization.slice('Bearer '.length).trim();
  const expected = configured.trim();
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return 'unauthorized';
  }
  return 'ok';
}

/**
 * Public map list and ingest. Mounted at `/map`.
 *
 * @param deps - Store, ingest token, BTC Map environment, and an optional clock.
 * @returns The map route group.
 */
export function mapRoutes(deps: MapRouteDeps): Hono {
  const now = deps.now ?? (() => Date.now());
  let sparLocationsCache: { fetchedAt: number; locations: unknown[] } | undefined;
  const app = new Hono();
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'OPTIONS'],
    }),
  );

  async function loadSparPaymentLinkLocations(url: string): Promise<unknown[] | undefined> {
    if (
      sparLocationsCache !== undefined &&
      now() - sparLocationsCache.fetchedAt < SPAR_LOCATIONS_CACHE_MS
    ) {
      return sparLocationsCache.locations;
    }
    try {
      const response = await deps.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'opencryptopay-api',
        },
        signal: AbortSignal.timeout(SPAR_LOCATIONS_TIMEOUT_MS),
      });
      if (response.status !== 200) {
        return undefined;
      }
      const body = await response.text();
      if (body.length > SPAR_LOCATIONS_BODY_MAX) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(body);
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      sparLocationsCache = { fetchedAt: now(), locations: parsed };
      return parsed;
    } catch {
      return undefined;
    }
  }

  app.get('/places', async (c) => {
    const limitQuery = c.req.query('limit');
    let limit = 1000;
    if (limitQuery !== undefined) {
      if (!/^\d+$/.test(limitQuery)) {
        return c.json({ error: 'Invalid limit' }, 400);
      }
      const n = Number(limitQuery);
      if (n < 1 || n > 1000) {
        return c.json({ error: 'Invalid limit' }, 400);
      }
      limit = n;
    }
    const originQuery = c.req.query('origin');
    let origin: string | undefined;
    if (originQuery !== undefined) {
      const parsedOrigin = normalizePlaceOrigin(originQuery);
      if (!parsedOrigin.ok) {
        return c.json({ error: parsedOrigin.error }, 400);
      }
      origin = parsedOrigin.value;
    }
    const parsedFilter = normalizeMapPlaceFilter(
      c.req.query('country'),
      c.req.query('shopName'),
      c.req.query('blockchain'),
      c.req.query('asset'),
    );
    if (!parsedFilter.ok) {
      return c.json({ error: parsedFilter.error }, 400);
    }
    const filter: MapPlaceListFilter = { ...parsedFilter.value };
    if (origin !== undefined) {
      filter.origin = origin;
    }
    const locationsUrl = sparLocationsUrl(deps.env);
    if (locationsUrl !== undefined) {
      const sparPlaces = deps.store.list(1000, { origin: 'spar', shopName: 'SPAR' });
      if (sparPlaces.length > 0) {
        const locations = await loadSparPaymentLinkLocations(locationsUrl);
        if (locations !== undefined) {
          deps.store.applySparPaymentLinkAddresses(
            sparPaymentLinkAddressUpdates(sparPlaces, SPAR_PAYMENT_LINK_NAME, locations),
          );
        }
      }
    }
    const places = deps.store.list(limit, filter).map((place) => toPublicMapPlace(place));
    return c.json({ places });
  });

  app.get('/filters', (c) => {
    const parsed = normalizeMapPlaceFilter(
      undefined,
      undefined,
      c.req.query('blockchain'),
      undefined,
    );
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const values = deps.store.filters(parsed.value.blockchain);
    return c.json(publicFilterResponse(values, parsed.value.blockchain));
  });

  app.post('/places', async (c) => {
    const auth = checkIngest(deps.ingestToken, c.req.header('authorization'));
    if (auth === 'unconfigured') {
      return c.json({ error: 'Place ingest is not configured' }, 503);
    }
    if (auth === 'unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = normalizeMapPlace(raw);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const { created, place } = deps.store.insertIfNew(parsed.value);
    let btcmap: MapPushResult = 'skipped';
    if (created) {
      btcmap = await pushMapPlace(place, deps.env, deps.fetchImpl);
    }
    return c.json({ created, id: place.id, btcmap }, created ? 201 : 200);
  });

  app.put('/places', async (c) => {
    const auth = checkIngest(deps.ingestToken, c.req.header('authorization'));
    if (auth === 'unconfigured') {
      return c.json({ error: 'Place ingest is not configured' }, 503);
    }
    if (auth === 'unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = normalizeMapPlace(raw);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const { created, place } = deps.store.upsert(parsed.value);
    let btcmap: MapPushResult = 'skipped';
    if (created) {
      btcmap = await pushMapPlace(place, deps.env, deps.fetchImpl);
    }
    return c.json({ created, id: place.id, btcmap }, created ? 201 : 200);
  });

  app.delete('/places', async (c) => {
    const auth = checkIngest(deps.ingestToken, c.req.header('authorization'));
    if (auth === 'unconfigured') {
      return c.json({ error: 'Place ingest is not configured' }, 503);
    }
    if (auth === 'unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = normalizeMapPlaceKey(raw);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const deleted = deps.store.deleteByKey(parsed.value.origin, parsed.value.externalId);
    return c.json({ deleted });
  });

  app.post('/places/transactions', async (c) => {
    const auth = checkIngest(deps.ingestToken, c.req.header('authorization'));
    if (auth === 'unconfigured') {
      return c.json({ error: 'Place ingest is not configured' }, 503);
    }
    if (auth === 'unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const nowMs = now();
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = normalizePlaceTransaction(raw, nowMs);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const place = deps.store.recordTransaction(
      parsed.value.origin,
      parsed.value.externalId,
      parsed.value.occurredAt,
      nowMs,
    );
    if (place === undefined) {
      return c.json({ error: 'Place not found' }, 404);
    }
    return c.json({ activity: place.activity });
  });

  return app;
}
