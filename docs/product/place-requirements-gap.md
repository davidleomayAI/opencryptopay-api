# Place requirements: target and current state

This note compares the [place requirements](place-requirements.md) (target)
with the current state. It was checked on 2026-10-16 against:

- code: `develop` at `707b349`
- production: `api.opencryptopay.io`, image built from `e603b76a` (#17), which
  does not contain #18 (address fields) or #19 (activity levels)
- development: `dev-api.opencryptopay.io`, image `beta` built from `develop`
- live data: `GET /map/places` on both hosts, all rows

Every row below that is not "met" is a defect against the requirements.

## Summary

| Req | Topic             | Code on `develop` | Production | Data                | Sources |
| --- | ----------------- | ----------------- | ---------- | ------------------- | ------- |
| R1  | Activity          | met               | not met    | not met (see R1)    | partly  |
| R2  | Address           | not met           | not met    | 0 of 193 complete   | not met |
| R3  | GPS coordinates   | met               | met        | 193 of 193          | met     |
| R4  | Name, description | not met           | not met    | 0 of 193 described  | not met |
| R5  | Shop type         | not met           | not met    | no such field       | not met |
| R6  | Enforcement       | not met           | not met    | 193 of 193 accepted | n/a     |

## Live data

Counts of rows with a non-empty value, per origin.

| Field                                         | Prod `spar` (170) | Prod `21gifts` (23) | Dev `spar` (170) | Dev `21gifts` (21) |
| --------------------------------------------- | ----------------- | ------------------- | ---------------- | ------------------ |
| `street`, `houseNumber`, `postalCode`, `city` | field absent      | field absent        | 0                | 0                  |
| `country`                                     | 170               | 4                   | 170              | 21                 |
| `lat`, `lon`                                  | 170               | 23                  | 170              | 21                 |
| description                                   | field absent      | field absent        | field absent     | field absent       |
| `shopName`                                    | 170 (`SPAR`)      | 0                   | 170 (`SPAR`)     | 0                  |
| name contains a 4-digit postal code           | 170               | 0                   | 170              | 0                  |

Activity on production: `spar` 170 `none`; `21gifts` 20 `within7Days`, 3
`none`. Activity on development: every row `none`.

Name examples: `SPAR Maschlinastrasse 4, 9495 Triesen` (`spar`) and
`Sta. Bakhita st. Happy land tondo ( Infront of the chapel )` (`21gifts`).

## R1 Activity

- **Target:** one of daily, last 7 days, last 30 days, older than 30 days,
  never; always present.
- **Code:** met. `activity` is always one of `daily`, `within7Days`,
  `within30Days`, `olderThan30Days`, `none` (`src/lib/map/place.ts`,
  `placeActivity`). `daily` is defined as at least five distinct UTC payment
  dates within the last seven UTC dates. A source cannot set it.
- **Code, open point:** a stored transaction time that cannot be parsed is
  classified `none`. The target reserves "never" for a shop with no
  transaction at all.
- **Production:** not met. It runs `e603b76a`, which only knows
  `within7Days`, `within30Days`, and `none`. `daily` and `olderThan30Days` are
  missing, so an old transaction shows as `none`.
- **Sources:** both report transactions through
  `POST /map/places/transactions`. All 170 SPAR rows show `none` on both
  hosts, so either no SPAR transaction has been reported or reports do not
  reach these rows. Which of the two is not established.

## R2 Address

- **Target:** street, house number, postal code, city, country; all required,
  each its own field, official spelling.
- **Code:** not met. `street`, `houseNumber`, `postalCode`, `city`, and
  `country` exist but are optional; an omitted part keeps the stored value or
  stays null (`normalizeOptionalAddressPart` in `src/lib/map/place.ts`). There
  is no check that the parts form a valid address.
- **Code, derived values:** the store fills a missing `country` from the name:
  the last four-digit word of a `spar` name, and a fixed name table for four
  `21gifts` rows (`backfillMissingCountry` in `src/lib/map/sqlite.ts`). R6
  forbids deriving a field from another field.
- **Production:** not met. The address fields do not exist in the response.
- **Data:** no row has a street, house number, postal code, or city. The SPAR
  address is only inside `name`. The 21.gifts names are free text with
  landmarks, not addresses.
- **DFX.swiss:** does not send any address. Its payment backend calls only
  `POST /map/places/transactions`. The 170 SPAR rows were registered by a
  manual import that accepts `origin`, `externalId`, `name`, `lat`, `lon`,
  `category`, `techProvider`, `paymentMethods`, and `country` and rejects any
  other key, so it cannot send the address fields either. DFX.swiss does hold
  a structured merchant address for a payment link but does not send it.
- **21.gifts:** sends `origin`, `externalId`, `name`, `lat`, `lon`,
  `category`, `paymentMethods`, and `techProvider`. It sends no address and
  holds no structured address for a shop.

## R3 GPS coordinates

- **Target:** latitude and longitude, required, at the shop.
- **Code:** met. `lat` and `lon` are required numbers in range and are
  rounded to six decimal places.
- **Data:** every row on both hosts has both.
- **Open point:** no check that the point lies at the R2 address, because R2
  data does not exist yet.

## R4 Name and description

- **Target:** a short descriptive name without the address, and a longer
  description; both required.
- **Code:** not met. `name` is required, 1 to 80 characters, but nothing keeps
  the address out of it. There is no description field in the input, the
  store, or the response.
- **Data:** all 170 SPAR names are `SPAR` plus the full address. 21.gifts names
  are the pin label, the author name, or `Shop`, cut to 80 characters.
- **Sources:** neither sends a description. 21.gifts has the shop post text,
  which it does not send. DFX.swiss has no description field for a shop.

## R5 Shop type

- **Target:** its own required enum field, values `SPAR` and `Others` for
  now, extensible, independent of the name.
- **Code:** not met. `shopName` is an optional free string of up to 40
  characters, not an enum. Only the query filter knows `SPAR` and `others`
  (lowercase), and `others` matches a row without a brand
  (`src/lib/map/store.ts`, `src/lib/map/sqlite.ts`).
- **Code, derived values:** the store sets `shopName` to `SPAR` for every
  `spar` row that has none. R5 forbids that derivation.
- **Data:** 170 rows `SPAR`, 23 (prod) and 21 (dev) rows null.
- **Sources:** neither sends a shop type.

## R6 Enforcement at registration

- **Target:** a registration or update without every field of R2 to R5 in the
  expected quality is rejected and stores nothing; incomplete stored rows are
  not public.
- **Code:** not met. `POST` and `PUT /map/places` accept a shop with only
  `origin`, `externalId`, `name`, `lat`, `lon`, and `category`. A missing
  country, address part, or brand is accepted. `GET /map/places` serves every
  stored row.
- **Data:** every one of the 193 production rows was accepted without a
  complete address, description, or shop type.

## What closes the gap

1. API: add a required description and a required shop type enum (`SPAR`,
   `Others`); make every address part required; reject incomplete or invalid
   input on `POST` and `PUT /map/places`; stop deriving `country` and
   `shopName`; leave incomplete stored rows out of `GET /map/places`.
2. DFX.swiss: send name, description, shop type, the full address, and
   coordinates for every SPAR shop through `PUT /map/places`.
3. 21.gifts: collect a structured address and a description for every shop
   and send them with the shop type.
4. Production: release `develop` so that R1 is served with all five levels.

Until steps 2 and 3 are done, step 1 removes every current shop from the
public list.
