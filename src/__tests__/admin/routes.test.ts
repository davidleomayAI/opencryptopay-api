import { generateKeyPairSync } from 'node:crypto';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AdminPublicKey } from '@/lib/admin/keys';
import { signAdminRequest } from '@/lib/admin/signature';
import type { MapPlaceInput } from '@/lib/map/place';
import { MemoryMapPlaceStore } from '@/lib/map/store';
import { createApp } from '@/server';

const DESCRIPTION =
  'SPAR supermarket in Triesen. Customers can pay with Bitcoin and other crypto assets through OpenCryptoPay at the checkout.';

const NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = 1_700_000_000;
const ADMIN_HOST = 'api.example.test';
const REQUEST_HOST = 'evil.test';

const pair = generateKeyPairSync('ed25519');
const desk: AdminPublicKey = { name: 'desk', publicKey: pair.publicKey };

const pin: MapPlaceInput = {
  origin: 'dfx',
  externalId: 'store-1',
  name: 'SPAR Triesen',
  description: DESCRIPTION,
  lat: 47.37,
  lon: 8.54,
  category: 'groceries',
  paymentMethods: 'lightning',
  shopType: 'SPAR',
  street: 'Maschlinastrasse',
  houseNumber: '4',
  postalCode: '9495',
  city: 'Triesen',
  country: 'LI',
  supports: [],
};

const fremd: MapPlaceInput = { ...pin, origin: 'fremd', externalId: 'shop-9' };

type Over = {
  host?: string;
  timestamp?: number;
  keyName?: string;
  nonce?: string;
  send?: Uint8Array;
};

function build(opts?: {
  omitKeys?: boolean;
  omitHost?: boolean;
  token?: string;
  store?: MemoryMapPlaceStore;
}): Hono {
  return createApp({
    store: opts?.store ?? new MemoryMapPlaceStore(),
    env: {},
    fetchImpl: async () => new Response('{}', { status: 201 }),
    now: () => NOW_MS,
    ...(opts?.omitKeys ? {} : { adminKeys: [desk] }),
    ...(opts?.omitHost ? {} : { adminHost: ADMIN_HOST }),
    ...(opts?.token === undefined ? {} : { ingestToken: opts.token }),
  });
}

function bind(
  api: ReturnType<typeof build>,
): (
  method: string,
  pathWithQuery: string,
  body?: Uint8Array,
  overrides?: Over,
) => Promise<Response> {
  return async function signed(
    method: string,
    pathWithQuery: string,
    body?: Uint8Array,
    overrides?: Over,
  ): Promise<Response> {
    const bytes = body ?? new Uint8Array();
    const headers = signAdminRequest({
      method,
      host: overrides?.host ?? ADMIN_HOST,
      pathWithQuery,
      timestamp: overrides?.timestamp ?? NOW_SECONDS,
      body: bytes,
      privateKey: pair.privateKey,
      keyName: overrides?.keyName ?? 'desk',
      ...(overrides?.nonce === undefined ? {} : { nonce: overrides.nonce }),
    });
    const init: RequestInit = { method, headers: { ...headers } };
    const wire = overrides?.send ?? (body === undefined ? undefined : bytes);
    if (wire !== undefined) {
      init.body = wire;
    }
    // Request host is evil.test. The signature uses api.example.test.
    return api.request(`http://${REQUEST_HOST}${pathWithQuery}`, init);
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value));
}

async function expectUnauthorized(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'Unauthorized' });
}

describe('admin routes', () => {
  it('answers 503 when admin keys are missing', async () => {
    const signed = bind(build({ omitKeys: true }));
    const response = await signed('GET', '/admin/places');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Admin is not configured' });
  });

  it('uses the real clock when no clock is injected', async () => {
    const api = createApp({
      store: new MemoryMapPlaceStore(),
      env: {},
      fetchImpl: async () => new Response('{}', { status: 201 }),
      adminKeys: [desk],
      adminHost: ADMIN_HOST,
    });
    const headers = signAdminRequest({
      method: 'GET',
      host: ADMIN_HOST,
      pathWithQuery: '/admin/places',
      timestamp: Math.floor(Date.now() / 1000),
      body: new Uint8Array(),
      privateKey: pair.privateKey,
      keyName: 'desk',
    });
    const response = await api.request(`http://${REQUEST_HOST}/admin/places`, {
      method: 'GET',
      headers: { ...headers },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ places: [] });
  });

  it('answers 503 when the admin host is missing', async () => {
    const signed = bind(build({ omitHost: true }));
    const response = await signed('GET', '/admin/places');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Admin is not configured' });
  });

  it('rejects a request with a missing admin header', async () => {
    const api = build();
    const names = [
      'OCP-Admin-Key',
      'OCP-Admin-Timestamp',
      'OCP-Admin-Signature',
      'OCP-Admin-Nonce',
    ] as const;
    for (const name of names) {
      const headers: Record<string, string> = {
        ...signAdminRequest({
          method: 'GET',
          host: ADMIN_HOST,
          pathWithQuery: '/admin/places',
          timestamp: NOW_SECONDS,
          body: new Uint8Array(),
          privateKey: pair.privateKey,
          keyName: 'desk',
        }),
      };
      delete headers[name];
      const response = await api.request(`http://${REQUEST_HOST}/admin/places`, { headers });
      await expectUnauthorized(response);
    }
  });

  it('rejects an unknown key', async () => {
    const signed = bind(build());
    const response = await signed('GET', '/admin/places', undefined, { keyName: 'other' });
    await expectUnauthorized(response);
  });

  it('rejects an expired timestamp', async () => {
    const signed = bind(build());
    const response = await signed('GET', '/admin/places', undefined, {
      timestamp: NOW_SECONDS - 61,
    });
    await expectUnauthorized(response);
  });

  it('rejects a signature for a different host', async () => {
    const signed = bind(build());
    const response = await signed('GET', '/admin/places', undefined, { host: 'other.example' });
    await expectUnauthorized(response);
  });

  it('rejects a body that differs from the signed bytes', async () => {
    const signed = bind(build());
    const response = await signed('PUT', '/admin/places', jsonBytes(fremd), {
      send: jsonBytes({ ...fremd, name: 'Andere Filiale' }),
    });
    await expectUnauthorized(response);
  });

  it('answers 413 for a signed body above 64 KiB', async () => {
    const signed = bind(build());
    const response = await signed('PUT', '/admin/places', new Uint8Array(64 * 1024 + 1));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
  });

  it('answers 413 for an unsigned body above 64 KiB', async () => {
    const response = await build().request(`http://${REQUEST_HOST}/admin/places`, {
      method: 'PUT',
      body: new Uint8Array(64 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
  });

  it('answers 503 before limiting an oversized body when admin is unconfigured', async () => {
    const response = await build({ omitKeys: true }).request(
      `http://${REQUEST_HOST}/admin/places`,
      {
        method: 'PUT',
        body: new Uint8Array(64 * 1024 + 1),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Admin is not configured' });
  });

  it('accepts two requests that differ only by nonce', async () => {
    const signed = bind(build());
    expect((await signed('GET', '/admin/places')).status).toBe(200);
    expect((await signed('GET', '/admin/places')).status).toBe(200);
  });

  it('rejects a replay of the same nonce', async () => {
    const signed = bind(build());
    const overrides: Over = { nonce: 'replay-nonce-012345' };
    expect((await signed('GET', '/admin/places', undefined, overrides)).status).toBe(200);
    await expectUnauthorized(await signed('GET', '/admin/places', undefined, overrides));
  });

  it('rejects a malformed nonce', async () => {
    const api = build();
    const headers: Record<string, string> = {
      ...signAdminRequest({
        method: 'GET',
        host: ADMIN_HOST,
        pathWithQuery: '/admin/places',
        timestamp: NOW_SECONDS,
        body: new Uint8Array(),
        privateKey: pair.privateKey,
        keyName: 'desk',
      }),
    };
    headers['OCP-Admin-Nonce'] = 'short';
    const response = await api.request(`http://${REQUEST_HOST}/admin/places`, { headers });
    await expectUnauthorized(response);
  });

  it('lists complete and incomplete places', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    store.insertIfNew(pin);
    store.insertIfNew({ ...pin, externalId: 'blank', name: '' });
    store.insertIfNew({ ...pin, externalId: 'cash', paymentMethods: null, name: 'Cash Shop' });
    const response = await bind(build({ store }))('GET', '/admin/places');
    expect(response.status).toBe(200);
    const listed = (await response.json()) as {
      places: Array<{
        name: string;
        complete: boolean;
        problems: string[];
        externalId: string;
        paymentMethods: string | null;
      }>;
    };
    const complete = listed.places.find((place) => place.name === pin.name);
    const incomplete = listed.places.find((place) => place.name === '');
    const cash = listed.places.find((place) => place.externalId === 'cash');
    expect(complete).toMatchObject({
      complete: true,
      problems: [],
      externalId: 'store-1',
      paymentMethods: 'lightning',
    });
    if (complete === undefined) {
      throw new Error('missing complete place');
    }
    expect(Object.keys(complete).sort()).toEqual(
      [
        'activity',
        'category',
        'city',
        'complete',
        'country',
        'description',
        'externalId',
        'houseNumber',
        'id',
        'lat',
        'lon',
        'name',
        'origin',
        'paymentMethods',
        'postalCode',
        'problems',
        'shopName',
        'shopType',
        'street',
        'supports',
        'techProvider',
      ].sort(),
    );
    expect(complete).not.toHaveProperty('lastTransactionAt');
    expect(incomplete?.complete).toBe(false);
    expect(incomplete?.problems.length).toBeGreaterThan(0);
    expect(incomplete).toMatchObject({ externalId: 'blank', paymentMethods: 'lightning' });
    expect(cash?.paymentMethods).toBeNull();
  });

  it('creates a foreign origin and then updates it', async () => {
    const signed = bind(build());
    const created = await signed('PUT', '/admin/places', jsonBytes(fremd));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ created: true });
    const updated = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...fremd, name: 'Filiale Nord' }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ created: false });
  });

  it('rejects an invalid put body', async () => {
    const signed = bind(build());
    const response = await signed('PUT', '/admin/places', Buffer.from('{'));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it('rejects an empty put body', async () => {
    const signed = bind(build());
    const response = await signed('PUT', '/admin/places', new Uint8Array());
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it('deletes a stored place and reports a miss', async () => {
    const signed = bind(build());
    const miss = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ origin: 'fremd', externalId: 'missing' }),
    );
    expect(miss.status).toBe(200);
    expect(await miss.json()).toEqual({ deleted: false });
    await signed('PUT', '/admin/places', jsonBytes(fremd));
    const hit = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ origin: 'fremd', externalId: 'shop-9' }),
    );
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual({ deleted: true });
  });

  it('rejects an invalid delete body', async () => {
    const signed = bind(build());
    const response = await signed('DELETE', '/admin/places', Buffer.from('nope'));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  function adminWithMap(store: MemoryMapPlaceStore): {
    calls: string[];
    signed: ReturnType<typeof bind>;
  } {
    const calls: string[] = [];
    const api = createApp({
      store,
      env: { BTCMAP_ACCESS_TOKEN: 'map-token' },
      fetchImpl: async (input: string) => {
        calls.push(input);
        return new Response('{}', { status: 201 });
      },
      now: () => NOW_MS,
      adminKeys: [desk],
      adminHost: ADMIN_HOST,
    });
    return { calls, signed: bind(api) };
  }

  it('upserts and may create when the body has no id', async () => {
    const { calls, signed } = adminWithMap(new MemoryMapPlaceStore(() => new Date(NOW_MS)));
    const created = await signed('PUT', '/admin/places', jsonBytes(fremd));
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { created: boolean; id: string; btcmap: string };
    expect(createdBody.created).toBe(true);
    expect(createdBody.btcmap).toBe('sent');
    expect(typeof createdBody.id).toBe('string');
    expect(calls).toHaveLength(1);
    const updated = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...fremd, name: 'Filiale Nord' }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      created: false,
      id: createdBody.id,
      btcmap: 'skipped',
    });
    expect(calls).toHaveLength(1);
  });

  it('rejects a blank or non-string public id and does not trim it', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const { calls, signed } = adminWithMap(store);
    for (const id of ['', '   ', null, 1, false, [], {}]) {
      const response = await signed(
        'PUT',
        '/admin/places',
        jsonBytes({ ...pin, id, name: 'Should Not Stick' }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Place id is required' });
    }
    const padded = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...pin, id: ` ${created.place.id} `, name: 'Should Not Stick' }),
    );
    expect(padded.status).toBe(404);
    expect(await padded.json()).toEqual({ error: 'Place not found' });
    expect(calls).toEqual([]);
    expect(store.getById(created.place.id)?.name).toBe(pin.name);
  });

  it('returns 404 for an unknown id and does not insert or call BTC Map', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const { calls, signed } = adminWithMap(store);
    const missing = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({
        ...pin,
        id: 'missing-id',
        origin: 'other',
        externalId: 'brand-new',
        name: 'Should Not Insert',
      }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Place not found' });
    const badOrigin = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ id: 'also-missing', origin: 'BAD', externalId: 'brand-new' }),
    );
    expect(badOrigin.status).toBe(404);
    expect(await badOrigin.json()).toEqual({ error: 'Place not found' });
    expect(calls).toEqual([]);
    expect(store.listAll()).toHaveLength(1);
    expect(store.getById(created.place.id)?.name).toBe(pin.name);
    expect(store.listAll().some((row) => row.externalId === 'brand-new')).toBe(false);
  });

  it('rejects a public id whose origin or caller id does not match and writes nothing', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const { calls, signed } = adminWithMap(store);
    const cases: Array<{ body: Record<string, unknown>; error: string }> = [
      { body: { origin: 'fremd', externalId: 'other' }, error: 'Place origin does not match' },
      { body: { origin: 'BAD', externalId: 'other' }, error: 'Place origin is invalid' },
      { body: { origin: 'dfx', externalId: 'other' }, error: 'Place external id does not match' },
      { body: { externalId: '' }, error: 'Place external id is required' },
      { body: { origin: 'dfx', externalId: 'bad\nid' }, error: 'Place external id is required' },
    ];
    for (const item of cases) {
      const response = await signed(
        'PUT',
        '/admin/places',
        jsonBytes({ ...pin, ...item.body, id: created.place.id, name: 'Should Not Stick' }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: item.error });
    }
    expect(calls).toEqual([]);
    expect(store.getById(created.place.id)?.name).toBe(pin.name);
  });

  it('does not write when the public id body fails place validation', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const { calls, signed } = adminWithMap(store);
    const badLat = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...pin, id: created.place.id, lat: 999, name: 'Should Not Stick' }),
    );
    expect(badLat.status).toBe(400);
    expect(await badLat.json()).toEqual({ error: 'Place must be a latitude and longitude' });
    const activity = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...pin, id: created.place.id, activity: 'daily', name: 'Should Not Stick' }),
    );
    expect(activity.status).toBe(400);
    expect(await activity.json()).toEqual({ error: 'Place field is not allowed: activity' });
    expect(calls).toEqual([]);
    expect(store.getById(created.place.id)?.name).toBe(pin.name);
    expect(store.getById(created.place.id)?.activity).toBe('none');
  });

  it('replaces operator columns by public id and leaves identity and activity state', async () => {
    const otherDescription =
      'Neighbourhood grocery in Zürich. Customers can pay with Bitcoin and other crypto assets through OpenCryptoPay at the checkout.';
    const nowMs = Date.parse('2026-10-08T12:00:00.000Z');
    const store = new MemoryMapPlaceStore(() => new Date(nowMs));
    const created = store.insertIfNew({
      ...pin,
      techProvider: '21.gifts',
      supports: [{ blockchain: 'Ethereum', asset: 'ZCHF' }],
    });
    const other = store.insertIfNew({ ...pin, externalId: 'store-2', name: 'Second Shop' });
    const day = (value: string): string => `${value}T12:00:00.000Z`;
    store.recordTransaction('dfx', 'store-1', day('2026-10-05'), nowMs);
    store.recordTransaction('dfx', 'store-1', day('2026-10-06'), nowMs);
    store.recordTransaction('dfx', 'store-1', day('2026-10-07'), nowMs);
    store.recordTransaction('dfx', 'store-1', day('2026-10-08'), nowMs);
    const before = store.getById(created.place.id);
    if (before === undefined) {
      throw new Error('missing stored place');
    }
    expect(before.activity).toBe('within7Days');
    expect(before.lastTransactionAt).toBe(day('2026-10-08'));
    const { calls, signed } = adminWithMap(store);
    const replaced = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({
        id: before.id,
        name: 'Other Shop',
        description: otherDescription,
        lat: 46.5,
        lon: 7.5,
        category: 'cafe',
        paymentMethods: 'onchain,lightning',
        techProvider: 'Acme.pay',
        shopType: 'Others',
        street: 'Bahnhofstrasse',
        houseNumber: '12',
        postalCode: '8001',
        city: 'Zürich',
        country: 'CH',
        supports: [{ blockchain: 'Bitcoin', asset: 'BTC' }],
      }),
    );
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({
      created: false,
      id: before.id,
      btcmap: 'skipped',
    });
    expect(calls).toEqual([]);
    const after = store.getById(before.id);
    expect(after).toMatchObject({
      id: before.id,
      origin: 'dfx',
      externalId: 'store-1',
      createdAt: before.createdAt,
      lastTransactionAt: before.lastTransactionAt,
      activity: 'within7Days',
      name: 'Other Shop',
      description: otherDescription,
      lat: 46.5,
      lon: 7.5,
      category: 'cafe',
      paymentMethods: 'onchain,lightning',
      techProvider: 'Acme.pay',
      shopType: 'Others',
      street: 'Bahnhofstrasse',
      houseNumber: '12',
      postalCode: '8001',
      city: 'Zürich',
      country: 'CH',
      supports: [{ blockchain: 'Bitcoin', asset: 'BTC' }],
    });
    const listed = await signed('GET', '/admin/places');
    const body = (await listed.json()) as {
      places: Array<Record<string, unknown>>;
    };
    const item = body.places.find((place) => place['id'] === before.id);
    expect(item).toMatchObject({
      name: 'Other Shop',
      externalId: 'store-1',
      paymentMethods: 'onchain,lightning',
      origin: 'dfx',
      activity: 'within7Days',
    });
    expect(item).not.toHaveProperty('lastTransactionAt');
    const fifth = store.recordTransaction('dfx', 'store-1', day('2026-10-04'), nowMs);
    expect(fifth?.activity).toBe('daily');
    expect(fifth?.lastTransactionAt).toBe(day('2026-10-08'));
    const cleared = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({
        id: before.id,
        name: 'Other Shop',
        description: otherDescription,
        lat: 46.5,
        lon: 7.5,
        category: 'cafe',
        paymentMethods: 'lightning',
        shopType: 'Others',
        street: 'Bahnhofstrasse',
        houseNumber: '12',
        postalCode: '8001',
        city: 'Zürich',
        country: 'CH',
      }),
    );
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({
      created: false,
      id: before.id,
      btcmap: 'skipped',
    });
    expect(store.getById(before.id)).toMatchObject({
      id: before.id,
      origin: 'dfx',
      externalId: 'store-1',
      createdAt: before.createdAt,
      lastTransactionAt: day('2026-10-08'),
      activity: 'daily',
      techProvider: 'DFX.swiss',
      paymentMethods: 'lightning',
      supports: [],
    });
    const still = store.recordTransaction('dfx', 'store-1', day('2026-10-08'), nowMs);
    expect(still?.activity).toBe('daily');
    expect(still?.lastTransactionAt).toBe(day('2026-10-08'));
    expect(store.getById(other.place.id)?.name).toBe('Second Shop');
    expect(store.listAll()).toHaveLength(2);
    expect(calls).toEqual([]);
  });

  it('keeps activityUntil across a public id replace', async () => {
    const nowMs = Date.parse('2026-10-08T12:00:00.000Z');
    const store = new MemoryMapPlaceStore(() => new Date(nowMs));
    const created = store.insertIfNew({ ...pin, techProvider: '21.gifts' });
    const last = '2026-10-08T12:00:00.000Z';
    store.recordTransaction(pin.origin, pin.externalId, last, nowMs);
    const until = Date.parse(last) + 7 * 24 * 60 * 60 * 1000 + 1;
    const { calls, signed } = adminWithMap(store);
    const replaced = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...pin, id: created.place.id, name: 'Renamed' }),
    );
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({
      created: false,
      id: created.place.id,
      btcmap: 'skipped',
    });
    expect(calls).toEqual([]);
    expect(store.getById(created.place.id)).toMatchObject({
      id: created.place.id,
      origin: pin.origin,
      externalId: pin.externalId,
      createdAt: created.place.createdAt,
      name: 'Renamed',
      lastTransactionAt: last,
      activity: 'within7Days',
    });
    store.refreshActivity(until - 1);
    expect(store.getById(created.place.id)?.activity).toBe('within7Days');
    store.refreshActivity(until);
    expect(store.getById(created.place.id)?.activity).toBe('within30Days');
    expect(store.getById(created.place.id)?.lastTransactionAt).toBe(last);
  });

  it('keeps the stored origin and caller id when they are omitted or match', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const signed = bind(build({ store }));
    const base = {
      name: 'Origin Kept',
      description: pin.description,
      lat: pin.lat,
      lon: pin.lon,
      category: pin.category,
      paymentMethods: pin.paymentMethods,
      shopType: pin.shopType,
      street: pin.street,
      houseNumber: pin.houseNumber,
      postalCode: pin.postalCode,
      city: pin.city,
      country: pin.country,
    };
    const withOrigin = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...base, id: created.place.id, origin: ' dfx ' }),
    );
    expect(withOrigin.status).toBe(200);
    expect(await withOrigin.json()).toEqual({
      created: false,
      id: created.place.id,
      btcmap: 'skipped',
    });
    expect(store.getById(created.place.id)).toMatchObject({
      name: 'Origin Kept',
      origin: 'dfx',
      externalId: 'store-1',
    });
    const withExternal = await signed(
      'PUT',
      '/admin/places',
      jsonBytes({ ...base, id: created.place.id, externalId: ' store-1 ', name: 'Caller Kept' }),
    );
    expect(withExternal.status).toBe(200);
    expect(store.getById(created.place.id)).toMatchObject({
      name: 'Caller Kept',
      origin: 'dfx',
      externalId: 'store-1',
    });
  });

  it('deletes by public id and leaves a different row', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const first = store.insertIfNew(pin);
    const second = store.insertIfNew({ ...pin, externalId: 'store-2' });
    const signed = bind(build({ store }));
    const removed = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ id: first.place.id, note: 'ignored' }),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ deleted: true });
    expect(store.getById(first.place.id)).toBeUndefined();
    expect(store.getById(second.place.id)?.externalId).toBe('store-2');
    const matched = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ id: second.place.id, origin: ' dfx ', externalId: ' store-2 ' }),
    );
    expect(matched.status).toBe(200);
    expect(await matched.json()).toEqual({ deleted: true });
    expect(store.listAll()).toHaveLength(0);
  });

  it('does not delete an unknown id, even when origin is present', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const signed = bind(build({ store }));
    const wrongId = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ id: 'missing-id', origin: 'dfx', externalId: 'store-1' }),
    );
    expect(wrongId.status).toBe(200);
    expect(await wrongId.json()).toEqual({ deleted: false });
    const badOrigin = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ id: 'missing-id', origin: 'NOT AN ORIGIN' }),
    );
    expect(badOrigin.status).toBe(200);
    expect(await badOrigin.json()).toEqual({ deleted: false });
    const padded = await signed(
      'DELETE',
      '/admin/places',
      jsonBytes({ id: ` ${created.place.id}` }),
    );
    expect(padded.status).toBe(200);
    expect(await padded.json()).toEqual({ deleted: false });
    expect(store.getById(created.place.id)?.externalId).toBe('store-1');
    expect(store.listAll()).toHaveLength(1);
  });

  it('does not delete when the public id origin or caller id does not match', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    const created = store.insertIfNew(pin);
    const signed = bind(build({ store }));
    const cases: Array<{ body: Record<string, unknown>; error: string }> = [
      { body: { origin: 'fremd', externalId: 'other' }, error: 'Place origin does not match' },
      { body: { origin: 'BAD', externalId: 'store-1' }, error: 'Place origin is invalid' },
      { body: { origin: 'dfx', externalId: 'other' }, error: 'Place external id does not match' },
      { body: { externalId: ' ' }, error: 'Place external id is required' },
    ];
    for (const item of cases) {
      const response = await signed(
        'DELETE',
        '/admin/places',
        jsonBytes({ id: created.place.id, ...item.body }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: item.error });
    }
    expect(store.getById(created.place.id)?.name).toBe(pin.name);
  });

  it('rejects a blank or non-string id on delete and deletes nothing', async () => {
    const store = new MemoryMapPlaceStore(() => new Date(NOW_MS));
    store.insertIfNew(pin);
    const signed = bind(build({ store }));
    for (const id of ['', '   ', null, 1, false]) {
      const response = await signed(
        'DELETE',
        '/admin/places',
        jsonBytes({ id, origin: 'dfx', externalId: 'store-1' }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Place id is required' });
    }
    expect(store.listAll()).toHaveLength(1);
    expect(store.listAll()[0]?.externalId).toBe('store-1');
  });

  it('returns 404 for a signed unknown path', async () => {
    const signed = bind(build());
    const response = await signed('GET', '/admin/no-such');
    expect(response.status).toBe(404);
  });

  it('still requires the ingest bearer on /map', async () => {
    const api = build({ token: 'secret' });
    const response = await api.request('/map/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pin),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});
