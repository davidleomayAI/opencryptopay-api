import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeActivity } from '../src/lib/map/place';
import { SqliteMapPlaceStore } from '../src/lib/map/sqlite';
import { MAP_PLACE_SCHEMA_SQL } from '../src/lib/map/store';

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

const dir = mkdtempSync(join(tmpdir(), 'sqlite-backfill-'));
const filename = join(dir, 'map.sqlite');
let seed: Database | undefined;
let store: SqliteMapPlaceStore | undefined;
let countryOk = false;
try {
  seed = new Database(filename);
  const statements = MAP_PLACE_SCHEMA_SQL.split(';')
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
    null,
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
    null,
    null,
  );
  insert.run(
    'spar-migros-row',
    'spar',
    'spar-migros',
    'Pin',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-03T00:00:00.000Z',
    'DFX.swiss',
    null,
    'Migros',
  );
  insert.run(
    'spar-ch-1713-row',
    'spar',
    'spar-ch-1713',
    'SPAR 1713',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-04T00:00:00.000Z',
    'DFX.swiss',
    null,
    null,
  );
  insert.run(
    'spar-li-9495-row',
    'spar',
    'spar-li-9495',
    'SPAR 9495 Triesen',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-05T00:00:00.000Z',
    'DFX.swiss',
    null,
    null,
  );
  insert.run(
    'spar-de-keep-row',
    'spar',
    'spar-de-keep',
    'SPAR 8001',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-06T00:00:00.000Z',
    'DFX.swiss',
    'DE',
    null,
  );
  insert.run(
    'gifts-ph-happyland-row',
    '21gifts',
    'gifts-ph-happyland',
    'Happyland Court Barangay 105 Tondo, Manila',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-07T00:00:00.000Z',
    '21.gifts',
    null,
    null,
  );
  insert.run(
    'gifts-ph-rose-row',
    '21gifts',
    'gifts-ph-rose',
    'Rose st.Happyland Barangay 105 Tondo,Manila',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-08T00:00:00.000Z',
    '21.gifts',
    null,
    null,
  );
  insert.run(
    'gifts-ke-machakos-row',
    '21gifts',
    'gifts-ke-machakos',
    'Machakos Bitcoin Academy',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-09T00:00:00.000Z',
    '21.gifts',
    null,
    null,
  );
  insert.run(
    'gifts-ke-makueni-row',
    '21gifts',
    'gifts-ke-makueni',
    'bitcoinmakueni',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-10T00:00:00.000Z',
    '21.gifts',
    null,
    null,
  );
  insert.run(
    'gifts-other-row',
    '21gifts',
    'gifts-other',
    'Other shop',
    47.37,
    8.54,
    'groceries',
    null,
    '2026-01-11T00:00:00.000Z',
    '21.gifts',
    null,
    null,
  );
  seed.close();
  seed = undefined;
  store = new SqliteMapPlaceStore(filename);
  const listed = store.list(20);
  const sparNull = listed.find((row) => row.externalId === 'spar-null');
  const dfxNull = listed.find((row) => row.externalId === 'dfx-null');
  const sparMigros = listed.find((row) => row.externalId === 'spar-migros');
  const sparCh1713 = listed.find((row) => row.externalId === 'spar-ch-1713');
  const sparLi9495 = listed.find((row) => row.externalId === 'spar-li-9495');
  const sparDeKeep = listed.find((row) => row.externalId === 'spar-de-keep');
  const giftsPhHappyland = listed.find((row) => row.externalId === 'gifts-ph-happyland');
  const giftsPhRose = listed.find((row) => row.externalId === 'gifts-ph-rose');
  const giftsKeMachakos = listed.find((row) => row.externalId === 'gifts-ke-machakos');
  const giftsKeMakueni = listed.find((row) => row.externalId === 'gifts-ke-makueni');
  const giftsOther = listed.find((row) => row.externalId === 'gifts-other');
  if (
    sparNull !== undefined &&
    dfxNull !== undefined &&
    sparMigros !== undefined &&
    sparCh1713 !== undefined &&
    sparLi9495 !== undefined &&
    sparDeKeep !== undefined &&
    giftsPhHappyland !== undefined &&
    giftsPhRose !== undefined &&
    giftsKeMachakos !== undefined &&
    giftsKeMakueni !== undefined &&
    giftsOther !== undefined &&
    sparNull.shopName === 'SPAR' &&
    sparNull.country === null &&
    dfxNull.shopName === null &&
    dfxNull.country === null &&
    sparMigros.shopName === 'Migros' &&
    sparMigros.country === null &&
    sparCh1713.country === 'CH' &&
    sparCh1713.shopName === 'SPAR' &&
    sparLi9495.country === 'LI' &&
    sparDeKeep.country === 'DE' &&
    giftsPhHappyland.country === 'PH' &&
    giftsPhRose.country === 'PH' &&
    giftsKeMachakos.country === 'KE' &&
    giftsKeMakueni.country === 'KE' &&
    giftsOther.country === null
  ) {
    countryOk = true;
  } else {
    process.stdout.write(
      `${JSON.stringify({
        'spar-null':
          sparNull === undefined
            ? null
            : { shopName: sparNull.shopName, country: sparNull.country },
        'dfx-null':
          dfxNull === undefined ? null : { shopName: dfxNull.shopName, country: dfxNull.country },
        'spar-migros':
          sparMigros === undefined
            ? null
            : { shopName: sparMigros.shopName, country: sparMigros.country },
        'spar-ch-1713':
          sparCh1713 === undefined
            ? null
            : { shopName: sparCh1713.shopName, country: sparCh1713.country },
        'spar-li-9495': sparLi9495 === undefined ? null : sparLi9495.country,
        'spar-de-keep': sparDeKeep === undefined ? null : sparDeKeep.country,
        'gifts-ph-happyland': giftsPhHappyland === undefined ? null : giftsPhHappyland.country,
        'gifts-ph-rose': giftsPhRose === undefined ? null : giftsPhRose.country,
        'gifts-ke-machakos': giftsKeMachakos === undefined ? null : giftsKeMachakos.country,
        'gifts-ke-makueni': giftsKeMakueni === undefined ? null : giftsKeMakueni.country,
        'gifts-other': giftsOther === undefined ? null : giftsOther.country,
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

if (countryOk) {
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
    const listed = activityStore.list(10);
    const noneRow = listed.find((row) => row.externalId === 'act-null');
    const oldRow = listed.find((row) => row.externalId === 'act-old');
    const recentRow = listed.find((row) => row.externalId === 'act-recent');
    activityStore.close();
    activityStore = undefined;
    const noneDays = noneRow === undefined ? null : paymentDaysFor(activityFile, noneRow.id);
    const oldDays = oldRow === undefined ? null : paymentDaysFor(activityFile, oldRow.id);
    const recentDays = recentRow === undefined ? null : paymentDaysFor(activityFile, recentRow.id);
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
    let dailyPlace = recentRow;
    let lastAfterExtra = recentRow?.lastTransactionAt;
    if (recentRow !== undefined) {
      for (const day of extraDays) {
        dailyPlace = activityStore.recordTransaction(
          'dfx',
          'act-recent',
          `${day}T12:00:00.000Z`,
          nowMs,
        );
      }
      lastAfterExtra = dailyPlace?.lastTransactionAt;
    }
    const countedDays = [recentDay, ...extraDays];
    const classified = placeActivity(recentIso, countedDays, nowMs);
    const untilMs = classified.until === null ? Number.NaN : Date.parse(classified.until);
    if (dailyPlace !== undefined && Number.isFinite(untilMs)) {
      activityStore.refreshActivity(untilMs - 1);
    }
    const beforePivot = activityStore.list(10).find((row) => row.externalId === 'act-recent');
    if (dailyPlace !== undefined && Number.isFinite(untilMs)) {
      activityStore.refreshActivity(untilMs);
    }
    const afterPivot = activityStore.list(10).find((row) => row.externalId === 'act-recent');
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
      noneDays !== null &&
      noneDays.length === 0 &&
      oldDays !== null &&
      oldDays.length === 0 &&
      recentDays !== null &&
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
          none: noneRow === undefined ? null : { activity: noneRow.activity, days: noneDays },
          old: oldRow === undefined ? null : { activity: oldRow.activity, days: oldDays },
          recent:
            recentRow === undefined ? null : { activity: recentRow.activity, days: recentDays },
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
