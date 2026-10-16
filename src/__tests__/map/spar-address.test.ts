import { describe, expect, it } from 'vitest';
import { sparPaymentLinkAddressUpdates, type SparAddressPlace } from '@/lib/map/spar-address';

const paymentLinkName = 'SPAR';
const street = 'Teststrasse';
const houseNumber = '7';
const zip = '1234';
const city = 'Testort';
const composite = `${paymentLinkName} ${street} ${houseNumber}, ${zip} ${city}`;
const location = { street, houseNumber, zip, city };

function place(overrides: Partial<SparAddressPlace> = {}): SparAddressPlace {
  return {
    origin: 'spar',
    externalId: 'spar-1',
    name: composite,
    shopName: 'SPAR',
    street: null,
    houseNumber: null,
    postalCode: null,
    city: null,
    ...overrides,
  };
}

describe('sparPaymentLinkAddressUpdates', () => {
  it('turns an exact composite into the payment-link name and four address fields', () => {
    expect(sparPaymentLinkAddressUpdates([place()], paymentLinkName, [location])).toEqual([
      {
        origin: 'spar',
        externalId: 'spar-1',
        name: 'SPAR',
        street,
        houseNumber,
        postalCode: zip,
        city,
      },
    ]);
  });

  it('returns no updates on a second call after the name is the payment-link name', () => {
    const updated = place({
      name: 'SPAR',
      street,
      houseNumber,
      postalCode: zip,
      city,
    });
    expect(sparPaymentLinkAddressUpdates([updated], paymentLinkName, [location])).toEqual([]);
  });

  it('updates nothing when two locations share one composite', () => {
    expect(
      sparPaymentLinkAddressUpdates([place()], paymentLinkName, [
        location,
        { ...location, country: 'CH' },
      ]),
    ).toEqual([]);
  });

  it('omits a place whose name is not a composite', () => {
    expect(
      sparPaymentLinkAddressUpdates([place({ name: 'SPAR Shop' })], paymentLinkName, [location]),
    ).toEqual([]);
  });

  it('omits an origin other than spar', () => {
    expect(
      sparPaymentLinkAddressUpdates([place({ origin: 'dfx' })], paymentLinkName, [location]),
    ).toEqual([]);
  });

  it('omits origin spar when shopName is null', () => {
    expect(
      sparPaymentLinkAddressUpdates([place({ shopName: null })], paymentLinkName, [location]),
    ).toEqual([]);
  });

  it('matches a street with a trailing space only on the raw composite', () => {
    const spacedStreet = 'Teststrasse ';
    const rawComposite = `${paymentLinkName} ${spacedStreet} ${houseNumber}, ${zip} ${city}`;
    expect(rawComposite).toBe('SPAR Teststrasse  7, 1234 Testort');
    const spacedLocation = { street: spacedStreet, houseNumber, zip, city };
    expect(
      sparPaymentLinkAddressUpdates([place({ name: rawComposite })], paymentLinkName, [
        spacedLocation,
      ]),
    ).toEqual([
      {
        origin: 'spar',
        externalId: 'spar-1',
        name: 'SPAR',
        street: spacedStreet,
        houseNumber,
        postalCode: zip,
        city,
      },
    ]);
    expect(
      sparPaymentLinkAddressUpdates(
        [place({ name: 'SPAR Teststrasse 7, 1234 Testort' })],
        paymentLinkName,
        [spacedLocation],
      ),
    ).toEqual([]);
  });

  it('skips a location without a string houseNumber', () => {
    expect(
      sparPaymentLinkAddressUpdates([place()], paymentLinkName, [
        { street, zip, city },
        { street, houseNumber: 7, zip, city },
        { houseNumber, zip, city },
        { street, houseNumber, city },
        { street, houseNumber, zip },
        null,
        ['Teststrasse', '7'],
        'SPAR',
      ]),
    ).toEqual([]);
  });

  it('returns no updates when the payment-link name is empty', () => {
    expect(sparPaymentLinkAddressUpdates([place()], '', [location])).toEqual([]);
  });
});
