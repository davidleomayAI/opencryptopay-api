import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMapPlaceStore } from '../src/lib/map/sqlite';
import { sparPaymentLinkAddressUpdates } from '../src/lib/map/spar-address';

const street = 'Teststrasse';
const houseNumber = '7';
const zip = '1234';
const city = 'Testort';
const composite = `SPAR ${street} ${houseNumber}, ${zip} ${city}`;
const location = { street, houseNumber, zip, city, country: 'CH' };

const dir = mkdtempSync(join(tmpdir(), 'ocp-spar-address-'));
const store = new SqliteMapPlaceStore(join(dir, 'places.sqlite'));
store.insertIfNew({
  origin: 'spar',
  externalId: 'spar-1',
  name: composite,
  lat: 47.14,
  lon: 9.52,
  category: 'groceries',
  paymentMethods: 'lightning',
  country: 'LI',
  shopName: 'SPAR',
});

const updates = sparPaymentLinkAddressUpdates(store.list(10), 'SPAR', [location]);
const changed = store.applySparPaymentLinkAddresses(updates);
const listed = store.list(10)[0];
const second = sparPaymentLinkAddressUpdates(store.list(10), 'SPAR', [location]);
const again = store.applySparPaymentLinkAddresses(updates);
store.close();
rmSync(dir, { recursive: true, force: true });

const ok =
  changed === 1 &&
  again === 0 &&
  second.length === 0 &&
  listed?.name === 'SPAR' &&
  listed.street === street &&
  listed.houseNumber === houseNumber &&
  listed.postalCode === zip &&
  listed.city === city &&
  listed.country === 'LI' &&
  listed.shopName === 'SPAR' &&
  listed.lat === 47.14;

if (!ok) {
  process.exit(1);
}
console.log('ok');
