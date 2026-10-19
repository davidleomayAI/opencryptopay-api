import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AdminPublicKey } from '@/lib/admin/keys';
import { verifyAdminRequest, type AdminReplayCache } from '@/lib/admin/signature';
import type { FetchLike } from '@/lib/map/btcmap';
import {
  normalizeExternalId,
  normalizeMapPlace,
  normalizePlaceOrigin,
  toPublicMapPlace,
  type StoredMapPlace,
} from '@/lib/map/place';
import { placeProblems, type MapPlaceStore } from '@/lib/map/store';
import { deletePlace, putPlace } from '@/routes/map';

export type AdminRouteDeps = {
  store: MapPlaceStore;
  env: Record<string, string | undefined>;
  fetchImpl: FetchLike;
  /** Allowed devices. Empty means admin is not configured. */
  keys: readonly AdminPublicKey[];
  /** Public host this instance answers as. Blank means admin is not configured. */
  host: string;
  now?: () => number;
};

type AdminEnv = {
  Variables: {
    rawBody: Uint8Array;
  };
};

const MAX_ADMIN_BODY_BYTES = 64 * 1024;

function pathWithQuery(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.pathname}${url.search}`;
}

function parseJsonBody(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

type ParsedPlaceId =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'id'; id: string; body: Record<string, unknown> };

/**
 * Read an own property `id` without trimming a non-empty value.
 * A non-object has no id. A blank or non-string id is invalid.
 *
 * @param raw - Parsed JSON.
 * @returns Whether `id` is absent, invalid, or a public id.
 */
function parsePlaceId(raw: unknown): ParsedPlaceId {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'absent' };
  }
  const body = raw as Record<string, unknown>;
  if (!Object.hasOwn(body, 'id')) {
    return { kind: 'absent' };
  }
  const id = body['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    return { kind: 'invalid' };
  }
  return { kind: 'id', id, body };
}

/**
 * Check a present origin, then a present external id, against the stored row.
 * Omitted fields stay stored.
 *
 * @param body - JSON object that includes `id`.
 * @param stored - The row addressed by that id.
 * @returns The first error, or undefined when both present fields name this row.
 */
function storedIdentityError(
  body: Record<string, unknown>,
  stored: StoredMapPlace,
): string | undefined {
  if (Object.hasOwn(body, 'origin')) {
    const origin = normalizePlaceOrigin(body['origin']);
    if (!origin.ok) {
      return origin.error;
    }
    if (origin.value !== stored.origin) {
      return 'Place origin does not match';
    }
  }
  if (Object.hasOwn(body, 'externalId')) {
    const externalId = normalizeExternalId(body['externalId']);
    if (!externalId.ok) {
      return externalId.error;
    }
    if (externalId.value !== stored.externalId) {
      return 'Place external id does not match';
    }
  }
  return undefined;
}

/**
 * Copy a place body for `normalizeMapPlace`: drop `id` and force the stored key.
 *
 * @param body - JSON object that includes `id`.
 * @param stored - The row addressed by that id.
 * @returns The body the place validator accepts.
 */
function bodyWithStoredIdentity(
  body: Record<string, unknown>,
  stored: StoredMapPlace,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...body };
  delete copy['id'];
  copy['origin'] = stored.origin;
  copy['externalId'] = stored.externalId;
  return copy;
}

/**
 * Signed admin maintenance for any origin. Mounted at `/admin`.
 * The signature uses the configured host, never the request Host header.
 * The body is read once and then parsed as JSON for PUT and DELETE.
 * Bodies above 64 KiB answer 413 before the signature is checked.
 * GET adds the caller id and payment methods beside the public place.
 * A JSON object with an own property `id` addresses that public id.
 * Without `id`, PUT and DELETE keep the origin and external id paths.
 *
 * @param deps - Store, BTC Map environment, allowed keys, configured host, and an optional clock.
 * @returns The admin route group.
 */
export function adminRoutes(deps: AdminRouteDeps): Hono<AdminEnv> {
  const now = deps.now ?? (() => Date.now());
  const replay: AdminReplayCache = new Map();
  const host = deps.host.trim();
  const configured = deps.keys.length > 0 && host !== '';
  const app = new Hono<AdminEnv>();

  app.use('*', async (c, next) => {
    if (!configured) {
      return c.json({ error: 'Admin is not configured' }, 503);
    }
    await next();
  });

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_ADMIN_BODY_BYTES,
      onError: (c) => c.json({ error: 'Payload too large' }, 413),
    }),
  );

  app.use('*', async (c, next) => {
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    const accepted = verifyAdminRequest({
      keys: deps.keys,
      keyName: c.req.header('OCP-Admin-Key'),
      timestamp: c.req.header('OCP-Admin-Timestamp'),
      nonce: c.req.header('OCP-Admin-Nonce'),
      signature: c.req.header('OCP-Admin-Signature'),
      method: c.req.method,
      host,
      pathWithQuery: pathWithQuery(c.req.url),
      body: rawBody,
      nowSeconds: Math.floor(now() / 1000),
      replay,
    });
    if (!accepted) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('rawBody', rawBody);
    await next();
  });

  app.get('/places', (c) => {
    const places = deps.store.listAll().map((place) => {
      const problems = placeProblems(place);
      return {
        ...toPublicMapPlace(place),
        complete: problems.length === 0,
        problems,
        externalId: place.externalId,
        paymentMethods: place.paymentMethods,
      };
    });
    return c.json({ places });
  });

  app.put('/places', async (c) => {
    const raw = parseJsonBody(c.get('rawBody'));
    const parsedId = parsePlaceId(raw);
    if (parsedId.kind === 'invalid') {
      return c.json({ error: 'Place id is required' }, 400);
    }
    if (parsedId.kind === 'absent') {
      const result = await putPlace(
        { store: deps.store, env: deps.env, fetchImpl: deps.fetchImpl },
        raw,
      );
      return c.json(result.body, result.status);
    }
    const stored = deps.store.getById(parsedId.id);
    if (stored === undefined) {
      return c.json({ error: 'Place not found' }, 404);
    }
    const identityError = storedIdentityError(parsedId.body, stored);
    if (identityError !== undefined) {
      return c.json({ error: identityError }, 400);
    }
    const parsed = normalizeMapPlace(bodyWithStoredIdentity(parsedId.body, stored));
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    deps.store.upsert(parsed.value);
    return c.json({ created: false, id: stored.id, btcmap: 'skipped' }, 200);
  });

  app.delete('/places', (c) => {
    const raw = parseJsonBody(c.get('rawBody'));
    const parsedId = parsePlaceId(raw);
    if (parsedId.kind === 'invalid') {
      return c.json({ error: 'Place id is required' }, 400);
    }
    if (parsedId.kind === 'absent') {
      const result = deletePlace({ store: deps.store }, raw);
      return c.json(result.body, result.status);
    }
    const stored = deps.store.getById(parsedId.id);
    if (stored === undefined) {
      return c.json({ deleted: false }, 200);
    }
    const identityError = storedIdentityError(parsedId.body, stored);
    if (identityError !== undefined) {
      return c.json({ error: identityError }, 400);
    }
    const deleted = deps.store.deleteById(parsedId.id);
    return c.json({ deleted }, 200);
  });

  return app;
}
