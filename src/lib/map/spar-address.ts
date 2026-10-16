export type SparPaymentLinkLocation = {
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
};

export type SparAddressUpdate = {
  origin: string;
  externalId: string;
  name: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
};

export type SparAddressPlace = {
  origin: string;
  externalId: string;
  name: string;
  shopName: string | null;
  street: string | null;
  houseNumber: string | null;
  postalCode: string | null;
  city: string | null;
};

function paymentLinkLocation(value: unknown): SparPaymentLinkLocation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  const street = rec['street'];
  const houseNumber = rec['houseNumber'];
  const zip = rec['zip'];
  const city = rec['city'];
  if (
    typeof street !== 'string' ||
    typeof houseNumber !== 'string' ||
    typeof zip !== 'string' ||
    typeof city !== 'string'
  ) {
    return undefined;
  }
  return { street, houseNumber, zip, city };
}

function locationComposite(paymentLinkName: string, location: SparPaymentLinkLocation): string {
  const { street, houseNumber, zip, city } = location;
  return `${paymentLinkName} ${street} ${houseNumber}, ${zip} ${city}`;
}

/**
 * Match stored SPAR pins to public payment-link locations and split the address.
 *
 * @param places - Stored pins. Only origin `spar` with shop name SPAR are considered.
 * @param paymentLinkName - Payment-link name. An empty string yields no updates.
 * @param locations - Public DFX location records.
 * @returns Narrow updates for pins whose name equals one unique composite.
 */
export function sparPaymentLinkAddressUpdates(
  places: readonly SparAddressPlace[],
  paymentLinkName: string,
  locations: readonly unknown[],
): SparAddressUpdate[] {
  if (paymentLinkName === '') {
    return [];
  }
  const counts = new Map<string, number>();
  const byComposite = new Map<string, SparPaymentLinkLocation>();
  for (const item of locations) {
    const location = paymentLinkLocation(item);
    if (location === undefined) {
      continue;
    }
    const composite = locationComposite(paymentLinkName, location);
    const seen = counts.get(composite);
    counts.set(composite, seen === undefined ? 1 : seen + 1);
    byComposite.set(composite, location);
  }
  const unique = new Map<string, SparPaymentLinkLocation>();
  for (const [composite, location] of byComposite) {
    if (counts.get(composite) === 1) {
      unique.set(composite, location);
    }
  }
  const updates: SparAddressUpdate[] = [];
  for (const place of places) {
    if (place.origin !== 'spar' || place.shopName !== 'SPAR') {
      continue;
    }
    const location = unique.get(place.name);
    if (location === undefined) {
      continue;
    }
    const update: SparAddressUpdate = {
      origin: place.origin,
      externalId: place.externalId,
      name: paymentLinkName,
      street: location.street,
      houseNumber: location.houseNumber,
      postalCode: location.zip,
      city: location.city,
    };
    /* v8 ignore start -- @preserve a composite name cannot already equal the payment-link name */
    if (
      place.name === update.name &&
      place.street === update.street &&
      place.houseNumber === update.houseNumber &&
      place.postalCode === update.postalCode &&
      place.city === update.city
    ) {
      continue;
    }
    /* v8 ignore stop -- @preserve */
    updates.push(update);
  }
  return updates;
}
