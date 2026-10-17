import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { expect, test } from '@playwright/test';

const DESCRIPTION =
  'SPAR supermarket in Triesen. Customers can pay with Bitcoin and other crypto assets through OpenCryptoPay at the checkout.';

const HOST = 'api.e2e.test';
const PATH = '/admin/places';
const KEY_NAME = 'e2e';

const fremd = {
  origin: 'fremd',
  externalId: 'e2e-admin-fremd',
  name: 'Fremde Filiale',
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
};

let replay:
  | {
      headers: Record<string, string>;
      body: string;
    }
  | undefined;

function privateKey(): KeyObject {
  const pem = process.env['OCP_E2E_ADMIN_PRIVATE_KEY'];
  if (pem === undefined || pem === '') {
    throw new Error('OCP_E2E_ADMIN_PRIVATE_KEY is missing');
  }
  return createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' });
}

function signedHeaders(
  method: string,
  pathWithQuery: string,
  body: Uint8Array,
  host = HOST,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('base64url');
  const hash = createHash('sha256').update(body).digest('hex');
  const canonical = [
    'OCP-ADMIN-v1',
    method.toUpperCase(),
    host,
    pathWithQuery,
    String(timestamp),
    nonce,
    hash,
  ].join('\n');
  const signature = sign(null, Buffer.from(canonical, 'utf8'), privateKey());
  return {
    'OCP-Admin-Key': KEY_NAME,
    'OCP-Admin-Timestamp': String(timestamp),
    'OCP-Admin-Nonce': nonce,
    'OCP-Admin-Signature': signature.toString('base64'),
  };
}

test('Function: adminRoutes — an unsigned /admin/places is 401', async ({ request }) => {
  const res = await request.get('/admin/places');
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: 'Unauthorized' });
});

test('Function: signAdminRequest — a signature for another host is 401', async ({ request }) => {
  const headers = signedHeaders('GET', PATH, new Uint8Array(), 'other.example');
  const res = await request.get('/admin/places', { headers });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: 'Unauthorized' });
});

test('Function: parseAdminPublicKeys — the e2e public key is accepted', async ({ request }) => {
  const path = '/admin/places?n=key';
  const res = await request.get(path, { headers: signedHeaders('GET', path, new Uint8Array()) });
  expect(res.status()).toBe(200);
});

test('Function: putPlace — PUT /admin/places creates a foreign origin', async ({ request }) => {
  const body = JSON.stringify(fremd);
  const headers = signedHeaders('PUT', PATH, Buffer.from(body));
  replay = { headers, body };
  const res = await request.put('/admin/places', { headers, data: body });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ created: true });
});

test('Function: canonicalString — the same signed request is a replay', async ({ request }) => {
  if (replay === undefined) {
    throw new Error('missing signed put');
  }
  const res = await request.put('/admin/places', { headers: replay.headers, data: replay.body });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: 'Unauthorized' });
});

test('Function: placeProblems — GET /admin/places shows complete and problems', async ({
  request,
}) => {
  const res = await request.get('/admin/places', {
    headers: signedHeaders('GET', PATH, new Uint8Array()),
  });
  expect(res.status()).toBe(200);
  const json = (await res.json()) as {
    places: Array<{ origin: string; name: string; complete: boolean; problems: string[] }>;
  };
  const row = json.places.find((place) => place.origin === 'fremd' && place.name === fremd.name);
  expect(row?.complete).toBe(true);
  expect(row?.problems).toEqual([]);
});

test('Function: verifyAdminRequest — a fresh signature is accepted', async ({ request }) => {
  const path = '/admin/places?n=verify';
  const res = await request.get(path, { headers: signedHeaders('GET', path, new Uint8Array()) });
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { places: Array<{ complete: boolean; problems: string[] }> };
  expect(json.places.some((place) => place.complete === true && place.problems.length === 0)).toBe(
    true,
  );
});

test('Function: deletePlace — DELETE /admin/places removes the pin', async ({ request }) => {
  const body = JSON.stringify({ origin: fremd.origin, externalId: fremd.externalId });
  const res = await request.delete('/admin/places', {
    headers: signedHeaders('DELETE', PATH, Buffer.from(body)),
    data: body,
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });
});
