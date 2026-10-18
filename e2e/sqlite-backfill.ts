import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNostrPubkey } from '../src/lib/map/nostr-key';
import { placeActivity } from '../src/lib/map/place';
import type { MapPlaceInput } from '../src/lib/map/place';
import { SqliteMapPlaceStore } from '../src/lib/map/sqlite';
import { placeProblems } from '../src/lib/map/store';

/** A valid NIP-01 key derived from a label, so each test row has its own. */
function keyFor(label: string): string {
  for (let round = 0; ; round += 1) {
    const candidate = createHash('sha256')
      .update(`${label}:${String(round)}`)
      .digest('hex');
    if (isNostrPubkey(candidate)) {
      return candidate;
    }
  }
}

const DESCRIPTION =
  'SPAR supermarket in Triesen. Customers can pay with Bitcoin and other crypto assets through OpenCryptoPay at the checkout.';

const COMPLETE: MapPlaceInput = {
  origin: 'dfx',
  externalId: 'dfx-null',
  name: 'SPAR Triesen',
  description: DESCRIPTION,
  lat: 47.37,
  lon: 8.54,
  category: 'groceries',
  paymentMethods: null,
  shopType: 'SPAR',
  street: 'Maschlinastrasse',
  houseNumber: '4',
  postalCode: '9495',
  city: 'Triesen',
  country: 'LI',
  supports: [],
  nostrPubkey: keyFor('dfx-null'),
};

const OLD_MAP_PLACE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS map_place (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  category TEXT NOT NULL,
  payment_methods TEXT,
  created_at TEXT NOT NULL,
  tech_provider TEXT NOT NULL DEFAULT 'DFX.swiss',
  country TEXT,
  shop_name TEXT,
  last_transaction_at TEXT,
  UNIQUE (origin, external_id)
);
CREATE TABLE IF NOT EXISTS map_place_support (
  place_id TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  asset TEXT NOT NULL,
  PRIMARY KEY (place_id, blockchain, asset),
  FOREIGN KEY (place_id) REFERENCES map_place(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_place_country ON map_place(country);
CREATE INDEX IF NOT EXISTS map_place_shop_name ON map_place(shop_name);
CREATE INDEX IF NOT EXISTS map_place_support_lookup
  ON map_place_support(blockchain, asset, place_id)`;

const OLD_MAP_PLACE_TABLE = `CREATE TABLE IF NOT EXISTS map_place (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  category TEXT NOT NULL,
  payment_methods TEXT,
  created_at TEXT NOT NULL,
  tech_provider TEXT NOT NULL DEFAULT 'DFX.swiss',
  country TEXT,
  shop_name TEXT,
  last_transaction_at TEXT,
  UNIQUE (origin, external_id)
)`;

function shiftUtcDay(day: string, deltaDays: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, date + deltaDays)).toISOString().slice(0, 10);
}

function paymentDaysFor(filename: string, placeId: string): string[] {
  const db = new Database(filename);
  try {
    const rows = db
      .query('SELECT day FROM map_place_payment_day WHERE place_id = ? ORDER BY day')
      .all(placeId) as Array<{ day: string }>;
    return rows.map((row) => row.day);
  } finally {
    db.close();
  }
}

function columnNames(filename: string): string[] {
  const db = new Database(filename);
  try {
    const rows = db.query('PRAGMA table_info(map_place)').all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

function placeCount(filename: string): number {
  const db = new Database(filename);
  try {
    const row = db.query('SELECT COUNT(*) AS n FROM map_place').get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function activityByExternalId(
  filename: string,
  externalId: string,
): { activity: string; last_transaction_at: string | null } | undefined {
  const db = new Database(filename);
  try {
    const row = db
      .query('SELECT activity, last_transaction_at FROM map_place WHERE external_id = ?')
      .get(externalId) as { activity: string; last_transaction_at: string | null } | null;
    return row === null ? undefined : row;
  } finally {
    db.close();
  }
}

const dir = mkdtempSync(join(tmpdir(), 'sqlite-backfill-'));
const filename = join(dir, 'map.sqlite');
let seed: Database | undefined;
let store: SqliteMapPlaceStore | undefined;
let schemaOk = false;
try {
  seed = new Database(filename);
  const statements = OLD_MAP_PLACE_SCHEMA_SQL.split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  for (const sql of statements) {
    seed.exec(sql);
  }
  const insert = seed.query(
    `INSERT INTO map_place (
       id, origin, external_id, name, lat, lon, category, payment_methods, created_at, tech_provider, country, shop_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    'spar-null-row',
    'spar',
    'spar-null',
    'Pin',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-01T00:00:00.000Z',
    'DFX.swiss',
    null,
    'SPAR',
  );
  insert.run(
    'dfx-null-row',
    'dfx',
    'dfx-null',
    'Pin',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-02T00:00:00.000Z',
    'DFX.swiss',
    'CH',
    null,
  );
  seed.close();
  seed = undefined;
  store = new SqliteMapPlaceStore(filename);
  const columns = columnNames(filename);
  const listed = store.list(20);
  const countries = store.filters().countries;
  const kept = placeCount(filename);
  if (
    columns.includes('description') &&
    columns.includes('shop_type') &&
    columns.includes('shop_name') &&
    kept === 2 &&
    listed.length === 0 &&
    countries.length === 0
  ) {
    const published = store.upsert(COMPLETE);
    const afterPut = store.list(20);
    const afterCountries = store.filters().countries;
    store.upsert({
      ...COMPLETE,
      origin: 'dfx',
      externalId: 'bad-time',
      nostrPubkey: keyFor('bad-time'),
      country: 'AT',
      postalCode: '1010',
      city: 'Wien',
      street: 'Kaerntner Strasse',
      houseNumber: '1',
      name: 'Hidden Clock Shop',
    });
    store.close();
    store = undefined;
    const patch = new Database(filename);
    patch
      .query("UPDATE map_place SET last_transaction_at = 'not-a-date' WHERE external_id = ?")
      .run('bad-time');
    patch.close();
    store = new SqliteMapPlaceStore(filename);
    const afterBad = store.list(20);
    const afterBadCountries = store.filters().countries;
    if (
      published.ok &&
      !published.created &&
      columns.includes('nostr_pubkey') &&
      afterPut.length === 1 &&
      afterPut[0]?.externalId === 'dfx-null' &&
      afterPut[0]?.country === 'LI' &&
      afterPut[0]?.shopType === 'SPAR' &&
      afterPut[0]?.description === DESCRIPTION &&
      afterCountries.includes('LI') &&
      !afterCountries.includes('CH') &&
      afterBad.every((row) => row.externalId !== 'bad-time') &&
      afterBadCountries.includes('LI') &&
      !afterBadCountries.includes('AT')
    ) {
      schemaOk = true;
    } else {
      process.stdout.write(
        `${JSON.stringify({
          published,
          afterPut: afterPut.map((row) => row.externalId),
          afterCountries,
          afterBad: afterBad.map((row) => row.externalId),
          afterBadCountries,
        })}\n`,
      );
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(
      `${JSON.stringify({
        columns,
        kept,
        listed: listed.map((row) => row.externalId),
        countries,
      })}\n`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : error })}\n`,
  );
  process.exitCode = 1;
} finally {
  try {
    if (seed !== undefined) {
      seed.close();
    }
    if (store !== undefined) {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let listAllOk = false;
if (schemaOk) {
  const listDir = mkdtempSync(join(tmpdir(), 'sqlite-list-all-'));
  const listFile = join(listDir, 'map.sqlite');
  let listStore: SqliteMapPlaceStore | undefined;
  try {
    listStore = new SqliteMapPlaceStore(listFile);
    const complete = listStore.insertIfNew({
      ...COMPLETE,
      externalId: 'complete',
      nostrPubkey: keyFor('complete'),
    });
    const incomplete = listStore.insertIfNew({
      ...COMPLETE,
      externalId: 'incomplete',
      nostrPubkey: keyFor('incomplete'),
      name: '',
    });
    const order = new Database(listFile);
    try {
      order
        .query('UPDATE map_place SET created_at = ? WHERE external_id = ?')
        .run('2000-01-01T00:00:00.000Z', 'complete');
      order
        .query('UPDATE map_place SET created_at = ? WHERE external_id = ?')
        .run('2100-01-01T00:00:00.000Z', 'incomplete');
    } finally {
      order.close();
    }
    const initialAll = listStore.listAll();
    for (let index = 0; index < 501; index += 1) {
      listStore.insertIfNew({
        ...COMPLETE,
        externalId: `bulk-${String(index)}`,
        nostrPubkey: keyFor(`bulk-${String(index)}`),
        name: `Bulk Place ${String(index)}`,
        supports: [{ blockchain: 'Bitcoin', asset: `BTC-${String(index)}` }],
      });
    }
    const all = listStore.listAll();
    const publicRows = listStore.list(1000);
    const bulk = all.filter((row) => row.externalId.startsWith('bulk-'));
    const clock = new Database(listFile);
    try {
      clock
        .query('UPDATE map_place SET last_transaction_at = ? WHERE external_id = ?')
        .run('-000001-01-01T00:00:00.000Z', 'complete');
    } finally {
      clock.close();
    }
    const negativeYear = listStore.listAll().find((row) => row.externalId === 'complete');
    const negativeYearProblems = negativeYear === undefined ? [] : placeProblems(negativeYear);
    const negativeYearHidden = listStore.list(1000).every((row) => row.externalId !== 'complete');
    if (
      complete.ok &&
      complete.created &&
      incomplete.ok &&
      incomplete.created &&
      initialAll.length === 2 &&
      initialAll[0]?.externalId === 'incomplete' &&
      initialAll[1]?.externalId === 'complete' &&
      all.length === 503 &&
      all[0]?.externalId === 'incomplete' &&
      all[all.length - 1]?.externalId === 'complete' &&
      publicRows.length === 502 &&
      publicRows.some((row) => row.externalId === 'complete') &&
      publicRows.every((row) => row.externalId !== 'incomplete') &&
      bulk.length === 501 &&
      bulk.every(
        (row) =>
          row.supports.length === 1 &&
          row.supports[0]?.blockchain === 'Bitcoin' &&
          row.supports[0]?.asset === `BTC-${row.externalId.slice('bulk-'.length)}`,
      ) &&
      negativeYearHidden &&
      negativeYearProblems.length === 1 &&
      negativeYearProblems[0] === 'lastTransactionAt is not a valid instant'
    ) {
      listAllOk = true;
    } else {
      process.stdout.write(
        `${JSON.stringify({
          all: all.length,
          initial: initialAll.map((row) => row.externalId),
          first: all[0]?.externalId,
          last: all[all.length - 1]?.externalId,
          publicRows: publicRows.length,
          publicIncomplete: publicRows.some((row) => row.externalId === 'incomplete'),
          bulk: bulk.length,
          bulkWithSupports: bulk.filter((row) => row.supports.length === 1).length,
          negativeYearHidden,
          negativeYearProblems,
        })}\n`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : error })}\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      if (listStore !== undefined) {
        listStore.close();
      }
    } finally {
      rmSync(listDir, { recursive: true, force: true });
    }
  }
}

let identityOk = false;
if (schemaOk && listAllOk) {
  const identityDir = mkdtempSync(join(tmpdir(), 'sqlite-identity-'));
  const identityFile = join(identityDir, 'map.sqlite');
  let identityStore: SqliteMapPlaceStore | undefined;
  try {
    identityStore = new SqliteMapPlaceStore(identityFile);
    const keyA = keyFor('identity-a');
    const keyB = keyFor('identity-b');
    const keyC = keyFor('identity-c');
    const base: MapPlaceInput = { ...COMPLETE, externalId: 'identity-1' };
    const keyless: MapPlaceInput = { ...base };
    delete keyless.nostrPubkey;
    const noKey = identityStore.insertIfNew(keyless, 1);
    const hiddenWithoutKey = identityStore
      .list(1000)
      .every((row) => row.externalId !== 'identity-1');
    const staleSame = identityStore.upsert({ ...base, nostrPubkey: keyA }, 1);
    const staleMissing = identityStore.upsert({ ...base, nostrPubkey: keyA });
    const addKey = identityStore.insertIfNew({ ...base, nostrPubkey: keyA }, 2);
    const changed = identityStore.upsert({ ...base, nostrPubkey: keyB }, 3);
    const keptOnPut = identityStore.upsert({ ...keyless, name: 'SPAR Triesen Nord' }, 3);
    const otherPair = identityStore.insertIfNew(
      { ...base, externalId: 'identity-2', nostrPubkey: keyA },
      1,
    );
    const found = identityStore.findPublicByPubkey(keyA);
    const missing = identityStore.findPublicByPubkey(keyC);
    const deleteStale = identityStore.deleteByKey('dfx', 'identity-1', 3);
    const deleted = identityStore.deleteByKey('dfx', 'identity-1', 4);
    const deletedAgain = identityStore.deleteByKey('dfx', 'identity-1', 5);
    const lateOld = identityStore.upsert({ ...base, nostrPubkey: keyA }, 5);
    const reuseOld = identityStore.insertIfNew({ ...base, nostrPubkey: keyA }, 6);
    const afterReuse = identityStore.findPublicByPubkey(keyA);
    identityStore.deleteByKey('dfx', 'identity-1', 7);
    const takenAfterDelete = identityStore.insertIfNew(
      { ...base, externalId: 'identity-3', nostrPubkey: keyA },
      undefined,
    );
    const newKey = identityStore.insertIfNew({ ...base, nostrPubkey: keyC }, 8);
    if (
      noKey.ok &&
      noKey.created &&
      noKey.place.nostrPubkey === null &&
      hiddenWithoutKey &&
      !staleSame.ok &&
      staleSame.error === 'Stale revision' &&
      !staleMissing.ok &&
      staleMissing.error === 'Stale revision' &&
      addKey.ok &&
      !addKey.created &&
      addKey.place.nostrPubkey === keyA &&
      !changed.ok &&
      changed.error === 'nostrPubkey of a place cannot change' &&
      keptOnPut.ok &&
      keptOnPut.place.nostrPubkey === keyA &&
      keptOnPut.place.name === 'SPAR Triesen Nord' &&
      !otherPair.ok &&
      otherPair.error === 'nostrPubkey belongs to another place' &&
      found?.externalId === 'identity-1' &&
      missing === undefined &&
      !deleteStale.ok &&
      deleted.ok &&
      deleted.deleted &&
      deletedAgain.ok &&
      !deletedAgain.deleted &&
      !lateOld.ok &&
      lateOld.error === 'Stale revision' &&
      reuseOld.ok &&
      reuseOld.created &&
      afterReuse?.externalId === 'identity-1' &&
      !takenAfterDelete.ok &&
      takenAfterDelete.error === 'nostrPubkey belongs to another place' &&
      newKey.ok &&
      newKey.place.nostrPubkey === keyC
    ) {
      identityOk = true;
    } else {
      process.stdout.write(
        `${JSON.stringify({
          noKey,
          hiddenWithoutKey,
          staleSame,
          staleMissing,
          addKey: addKey.ok,
          changed,
          keptOnPut: keptOnPut.ok,
          otherPair,
          found: found?.externalId,
          missing,
          deleteStale,
          deleted,
          deletedAgain,
          lateOld,
          reuseOld: reuseOld.ok,
          afterReuse: afterReuse?.externalId,
          takenAfterDelete,
          newKey: newKey.ok,
        })}\n`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : error })}\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      if (identityStore !== undefined) {
        identityStore.close();
      }
    } finally {
      rmSync(identityDir, { recursive: true, force: true });
    }
  }
}

if (schemaOk && listAllOk && identityOk) {
  const activityDir = mkdtempSync(join(tmpdir(), 'sqlite-activity-backfill-'));
  const activityFile = join(activityDir, 'map.sqlite');
  let activitySeed: Database | undefined;
  let activityStore: SqliteMapPlaceStore | undefined;
  try {
    const nowMs = Date.now();
    const oldIso = new Date(nowMs - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recentMs = nowMs - 60 * 60 * 1000;
    const recentIso = new Date(recentMs).toISOString();
    activitySeed = new Database(activityFile);
    activitySeed.exec(OLD_MAP_PLACE_TABLE);
    const insert = activitySeed.query(
      `INSERT INTO map_place (
         id, origin, external_id, name, lat, lon, category, payment_methods, created_at, tech_provider, country, shop_name, last_transaction_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'act-null-row',
      'dfx',
      'act-null',
      'Pin',
      47.37,
      8.54,
      'groceries',
      null,
      '2026-01-01T00:00:00.000Z',
      'DFX.swiss',
      null,
      null,
      null,
    );
    insert.run(
      'act-old-row',
      'dfx',
      'act-old',
      'Pin',
      47.37,
      8.54,
      'groceries',
      null,
      '2026-01-02T00:00:00.000Z',
      'DFX.swiss',
      null,
      null,
      oldIso,
    );
    insert.run(
      'act-recent-row',
      'dfx',
      'act-recent',
      'Pin',
      47.37,
      8.54,
      'groceries',
      null,
      '2026-01-03T00:00:00.000Z',
      'DFX.swiss',
      null,
      null,
      recentIso,
    );
    activitySeed.close();
    activitySeed = undefined;
    activityStore = new SqliteMapPlaceStore(activityFile);
    activityStore.close();
    activityStore = undefined;
    const noneRow = activityByExternalId(activityFile, 'act-null');
    const oldRow = activityByExternalId(activityFile, 'act-old');
    const recentRow = activityByExternalId(activityFile, 'act-recent');
    const noneDays = paymentDaysFor(activityFile, 'act-null-row');
    const oldDays = paymentDaysFor(activityFile, 'act-old-row');
    const recentDays = paymentDaysFor(activityFile, 'act-recent-row');
    activityStore = new SqliteMapPlaceStore(activityFile);
    const recentDay = new Date(recentMs).toISOString().slice(0, 10);
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const windowStart = shiftUtcDay(today, -6);
    const extraDays: string[] = [];
    for (let delta = 1; extraDays.length < 4; delta += 1) {
      const day = shiftUtcDay(recentDay, -delta);
      if (day < windowStart) {
        break;
      }
      extraDays.push(day);
    }
    let dailyPlace = activityStore.recordTransaction('dfx', 'act-recent', 'not-a-date', nowMs);
    let lastAfterExtra = dailyPlace?.lastTransactionAt;
    for (const day of extraDays) {
      dailyPlace = activityStore.recordTransaction(
        'dfx',
        'act-recent',
        `${day}T12:00:00.000Z`,
        nowMs,
      );
    }
    lastAfterExtra = dailyPlace?.lastTransactionAt;
    const countedDays = [recentDay, ...extraDays];
    const classified = placeActivity(recentIso, countedDays, nowMs);
    const untilMs = classified.until === null ? Number.NaN : Date.parse(classified.until);
    if (dailyPlace !== undefined && Number.isFinite(untilMs)) {
      activityStore.refreshActivity(untilMs - 1);
    }
    const beforePivot = activityStore.recordTransaction('dfx', 'act-recent', 'not-a-date', nowMs);
    if (dailyPlace !== undefined && Number.isFinite(untilMs)) {
      activityStore.refreshActivity(untilMs);
    }
    const afterPivot = activityStore.recordTransaction('dfx', 'act-recent', 'not-a-date', nowMs);
    activityStore.close();
    activityStore = undefined;
    const staleDays = new Database(activityFile);
    try {
      staleDays
        .query('INSERT INTO map_place_payment_day (place_id, day) VALUES (?, ?)')
        .run('act-recent-row', '1999-01-01');
    } finally {
      staleDays.close();
    }
    activityStore = new SqliteMapPlaceStore(activityFile);
    activityStore.recordTransaction('dfx', 'act-recent', 'not-a-date', nowMs);
    const daysAfterUnparseable = paymentDaysFor(activityFile, 'act-recent-row');
    activityStore.recordTransaction('dfx', 'act-recent', `${recentDay}T12:00:00.000Z`, nowMs);
    const daysAfterParseable = paymentDaysFor(activityFile, 'act-recent-row');
    if (
      noneRow !== undefined &&
      oldRow !== undefined &&
      recentRow !== undefined &&
      noneRow.activity === 'none' &&
      oldRow.activity === 'olderThan30Days' &&
      recentRow.activity === 'within7Days' &&
      noneDays.length === 0 &&
      oldDays.length === 0 &&
      recentDays.length === 1 &&
      extraDays.length === 4 &&
      classified.activity === 'daily' &&
      dailyPlace?.activity === 'daily' &&
      lastAfterExtra === recentIso &&
      beforePivot?.activity === 'daily' &&
      afterPivot?.activity === 'within7Days' &&
      afterPivot?.lastTransactionAt === recentIso &&
      daysAfterUnparseable.includes('1999-01-01') &&
      !daysAfterParseable.includes('1999-01-01') &&
      daysAfterParseable.includes(recentDay)
    ) {
      process.stdout.write('ok\n');
    } else {
      process.stdout.write(
        `${JSON.stringify({
          none: noneRow,
          old: oldRow,
          recent: recentRow,
          noneDays,
          oldDays,
          recentDays,
          extraDays,
          daily: dailyPlace === undefined ? null : dailyPlace.activity,
          lastAfterExtra,
          beforePivot: beforePivot === undefined ? null : beforePivot.activity,
          afterPivot: afterPivot === undefined ? null : afterPivot.activity,
          daysAfterUnparseable,
          daysAfterParseable,
        })}\n`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : error })}\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      if (activitySeed !== undefined) {
        activitySeed.close();
      }
      if (activityStore !== undefined) {
        activityStore.close();
      }
    } finally {
      rmSync(activityDir, { recursive: true, force: true });
    }
  }
}
