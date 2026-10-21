import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMapPlaceStore } from '../src/lib/map/sqlite';
import { MAP_PLACE_SCHEMA_SQL } from '../src/lib/map/store';

describe('SqliteMapPlaceStore.setActiveById', () => {
  test('writes only active and leaves SQL NULL columns NULL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'set-active-'));
    const filename = join(dir, 'map.sqlite');
    // tech_provider is NOT NULL in MAP_PLACE_SCHEMA_SQL. This file drops that
    // so a raw NULL can be stored and the flag write can be checked against it.
    const seed = new Database(filename);
    seed.exec(
      MAP_PLACE_SCHEMA_SQL.replace(
        "tech_provider TEXT NOT NULL DEFAULT 'DFX.swiss'",
        'tech_provider TEXT',
      ),
    );
    seed
      .query(
        `INSERT INTO map_place (
           id, origin, external_id, name, lat, lon, category, created_at, activity, active,
           description, street, house_number, postal_code, city, country, shop_type,
           tech_provider, nostr_pubkey
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'raw-null',
        'dfx',
        'raw-1',
        'Raw Shop',
        47.1,
        8.5,
        'groceries',
        '2026-01-01T00:00:00.000Z',
        'none',
        1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      );
    seed.close();
    const store = new SqliteMapPlaceStore(filename);
    try {
      const updated = store.setActiveById({ id: 'raw-null', active: false });
      expect(updated).toMatchObject({
        status: 'updated',
        place: {
          id: 'raw-null',
          active: false,
          name: 'Raw Shop',
          origin: 'dfx',
          nostrPubkey: null,
        },
      });
      expect(store.setActiveById({ id: 'missing-id', active: true })).toEqual({
        status: 'missing',
      });
      const db = new Database(filename);
      try {
        const row = db
          .query(
            `SELECT description, street, house_number, postal_code, city, country, shop_type,
                    tech_provider, nostr_pubkey, active, name, origin, activity, activity_until
             FROM map_place WHERE id = ?`,
          )
          .get('raw-null') as {
          description: string | null;
          street: string | null;
          house_number: string | null;
          postal_code: string | null;
          city: string | null;
          country: string | null;
          shop_type: string | null;
          tech_provider: string | null;
          nostr_pubkey: string | null;
          active: number;
          name: string;
          origin: string;
          activity: string;
          activity_until: string | null;
        };
        expect(row).toEqual({
          description: null,
          street: null,
          house_number: null,
          postal_code: null,
          city: null,
          country: null,
          shop_type: null,
          tech_provider: null,
          nostr_pubkey: null,
          active: 0,
          name: 'Raw Shop',
          origin: 'dfx',
          activity: 'none',
          activity_until: null,
        });
        const supports = db.query('SELECT COUNT(*) AS n FROM map_place_support').get() as {
          n: number;
        };
        expect(supports.n).toBe(0);
        const places = db.query('SELECT COUNT(*) AS n FROM map_place').get() as { n: number };
        expect(places.n).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
