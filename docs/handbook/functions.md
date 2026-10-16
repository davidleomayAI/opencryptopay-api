# Functions

## Function: normalizePlaceOrigin

- **Purpose:** Trim a pin origin and accept only `^[a-z0-9][a-z0-9-]{0,31}$`. A leading digit is valid. Uppercase tokens such as SPAR are invalid.
- **Inputs:** Unknown value, typically a JSON field or the `origin` query string.
- **Returns / side effects:** `{ ok: true, value }` with the trimmed origin, or `{ ok: false, error: "Place origin is invalid" }`. No I/O.
- **Used by:** `normalizeMapPlace`, `normalizeMapPlaceKey`, and `mapRoutes` on `GET /map/places`.

## Function: normalizeMapPlace

- **Purpose:** Validate a JSON body for one map pin. Coordinates must be finite and in range, then they are rounded to six decimals. An unknown payment list becomes null instead of an error. An omitted tech provider is left unset so the store can default it. Optional `country` is the DFX country symbol (ISO 3166-1 alpha-2), trimmed and uppercased, or omitted. Optional `shopName` is a brand of 1 to 40 characters, not casefolded. Optional `supports` is a list of DFX payment-network and asset-name pairs; omitted leaves the field unset so an upsert can keep the stored rows. Optional `street`, `houseNumber`, `postalCode`, and `city` are trimmed strings of 1 to 120, 1 to 32, 1 to 16, and 1 to 80 characters. Empty text and control characters are invalid. An omitted field, including JSON null, leaves that part unset so an upsert can keep the stored value.
- **Inputs:** Unknown JSON. Required fields are `origin`, `externalId`, `name`, `lat`, `lon`, and `category`. `techProvider`, `country`, `street`, `houseNumber`, `postalCode`, `city`, `shopName`, and `supports` are optional.
- **Returns / side effects:** `{ ok: true, value }` or `{ ok: false, error }` with a fixed English message. No I/O.
- **Used by:** `mapRoutes` on `POST /map/places` and `PUT /map/places`.

## Function: normalizeMapPlaceFilter

- **Purpose:** Validate the optional `country`, `shopName`, `blockchain`, and `asset` query strings for the public map. Omitted parameters stay off the filter. `country` is trimmed and uppercased. `shopName` is trimmed and must be `SPAR` or `others`. `blockchain` and `asset` are trimmed and not casefolded. A filter blockchain may be a stored payment-network name or a payment-link network such as BinancePay or KucoinPay. A filter asset may be a ticker, a prefixed ticker, or a catalog name such as ckBTC or dEURO. A support body still uses the stricter stored-pair rules.
- **Inputs:** Four optional raw query strings.
- **Returns / side effects:** `{ ok: true, value }` with the present filter fields, or `{ ok: false, error }` with `Place country is invalid`, `Place shop name is invalid`, or `Place support is invalid`. No I/O.
- **Used by:** `mapRoutes` on `GET /map/places` and `GET /map/filters`.

## Function: isCatalogBlockchain

- **Purpose:** Report whether a trimmed blockchain query is in the hardcoded payment-link catalog. Test networks, Plasma, and names that are not payment-link networks are excluded. BinancePay and KucoinPay are included.
- **Inputs:** A trimmed blockchain string.
- **Returns / side effects:** True or false. No I/O.
- **Used by:** `normalizeMapPlaceFilter` when a blockchain query is not a stored payment-network name.

## Function: isCatalogAsset

- **Purpose:** Report whether a trimmed asset query is in the hardcoded payment-link catalog. This includes names that are not plain tickers, such as ckBTC and dEURO.
- **Inputs:** A trimmed asset string.
- **Returns / side effects:** True or false. No I/O.
- **Used by:** `normalizeMapPlaceFilter` when an asset query is not a ticker or a prefixed ticker.

## Function: matchesUnstatedPayment

- **Purpose:** Decide whether a pin with no stored support rows matches a blockchain or asset filter. Origin `21gifts` or tech provider `21.gifts` matches Lightning and BTC only. Every other pin matches a catalog network, a catalog asset, or a catalog pair. An omitted filter matches.
- **Inputs:** Stored origin, stored tech provider, and the optional blockchain and asset from the query.
- **Returns / side effects:** True when the pin stays in the list. No I/O.
- **Used by:** `MemoryMapPlaceStore.list`. The SQLite driver uses `unstatedPaymentSql` for the same rule.

## Function: unstatedPaymentSql

- **Purpose:** Build the SQLite predicate for a blockchain or asset filter. Stored support rows still match. A pin with no support rows matches only when the hardcoded catalog offers that network or asset for its origin and tech provider. A request outside the catalog returns null so only stored rows match.
- **Inputs:** Optional blockchain and asset query values.
- **Returns / side effects:** A parenthesised SQL fragment and its bound parameters, or null. No I/O.
- **Used by:** `SqliteMapPlaceStore.list`.

## Function: publicFilterResponse

- **Purpose:** Merge distinct stored filter values with the hardcoded payment-link catalog for `GET /map/filters`. `?blockchain=` limits the top-level asset list. `techProviders` always contains the full `DFX.swiss` offer and the `21.gifts` offer of Lightning and BTC.
- **Inputs:** Stored countries, blockchains, and assets, plus an optional blockchain query.
- **Returns / side effects:** `{ shopNames, countries, blockchains, assets, techProviders }`. No I/O.
- **Used by:** `mapRoutes` on `GET /map/filters`.

## Function: normalizeMapPlaceKey

- **Purpose:** Validate origin and external id for deleting a map pin. Extra JSON fields are ignored. The body does not need coordinates or a name.
- **Inputs:** Unknown JSON. Required fields are `origin` and `externalId`, with the same rules as `normalizeMapPlace`.
- **Returns / side effects:** `{ ok: true, value: { origin, externalId } }` or `{ ok: false, error }` with the same English messages as create. No I/O.
- **Used by:** `mapRoutes` on `DELETE /map/places`.

## Function: placeActivity

- **Purpose:** Classify a stored transaction instant and payment days into `daily`, `within7Days`, `within30Days`, `olderThan30Days`, or `none`. First match wins. `daily` is at least five distinct stored UTC dates (`YYYY-MM-DD`) that lie on the UTC date of `nowMs` or on one of the previous six UTC dates. Duplicates and strings that are not that date form or that lie outside the window are ignored. `within7Days` is a parseable instant whose age is at most `7 * 24 * 60 * 60 * 1000` ms (exactly 7 days stays here; a future instant stays here) when the row is not `daily`. `within30Days` is older than 7×24h and at most 30×24h (exactly 30 days stays here). One millisecond past 30×24h is `olderThan30Days`, not `none`. `none` is a null or unparseable instant when the row is not `daily`.
- **Inputs:** `lastTransactionAt` (`string | null`), `paymentDays` (readonly UTC date strings), and `nowMs` (maintenance clock in milliseconds).
- **Returns / side effects:** `{ activity, until }`. For `daily`, `until` is UTC midnight at the start of the fifth-newest counted day plus 7 days. For `within7Days` and `within30Days`, `until` is one millisecond after the 7-day or 30-day bound. For `olderThan30Days` and `none`, `until` is null. No I/O.
- **Used by:** `MemoryMapPlaceStore` and `SqliteMapPlaceStore` on the transaction write and when `activity_until` is due.

## Function: normalizePlaceTransaction

- **Purpose:** Validate a JSON body that records a shop transaction. `origin` and `externalId` use `normalizeMapPlaceKey` and the same error strings. Extra JSON fields are ignored. Omitted `occurredAt` becomes `new Date(nowMs).toISOString()`. A present `occurredAt` must be a parseable string at most 120 seconds after `nowMs`; exactly `nowMs + 120_000` is valid and one millisecond later is not. The returned instant is canonical ISO (`new Date(parsed).toISOString()`), not the raw string.
- **Inputs:** Unknown JSON and `nowMs`. Required fields are `origin` and `externalId`. `occurredAt` is optional.
- **Returns / side effects:** `{ ok: true, value: { origin, externalId, occurredAt } }` or `{ ok: false, error }` including `Place transaction time is invalid`. No I/O.
- **Used by:** `mapRoutes` on `POST /map/places/transactions`.

## Function: toPublicMapPlace

- **Purpose:** Strip the caller id and payment methods before a pin is shown on the public map. The tech provider, country, street, house number, postal code, city, shop name, and supports stay on the public row. `street`, `houseNumber`, `postalCode`, and `city` are each a string or null and are separate from `name`. `activity` is copied from the stored pin. A read does not reclassify.
- **Inputs:** A stored map pin.
- **Returns / side effects:** `id`, `origin`, `name`, `lat`, `lon`, `category`, `techProvider`, `country`, `street`, `houseNumber`, `postalCode`, `city`, `shopName`, `supports`, and `activity`. No I/O.
- **Used by:** `mapRoutes` on `GET /map/places`.

## Function: sparPaymentLinkAddressUpdates

- **Purpose:** Match stored SPAR shops to the public DFX payment-link location list without parsing a stored name. A usable location is a non-array object whose street, house number, zip, and city are raw strings. The composite is the payment-link name plus those four fields. A composite that appears more than once updates nothing. A pin is considered only when origin is `spar` and shop name is SPAR. When the stored name equals one unique composite, the update sets name to the payment-link name and the four address fields, with zip stored as postal code. An empty payment-link name returns no updates. Already-equal fields are omitted. Unmatched locations do not create a pin.
- **Inputs:** Stored places (origin, external id, name, shop name, and the four address fields), the payment-link name (not trimmed), and the public location array.
- **Returns / side effects:** An array of narrow updates (`origin`, `externalId`, `name`, `street`, `houseNumber`, `postalCode`, `city`). No I/O. Country, shop name, coordinates, category, tech provider, supports, and activity are not in the result.
- **Used by:** `mapRoutes` on `GET /map/places` before the public list.

## Function: MemoryMapPlaceStore

- **Purpose:** In-memory map store with the same insert-once, upsert, delete, `recordTransaction`, `refreshActivity`, and `applySparPaymentLinkAddresses` rules as SQLite. New rows store `lastTransactionAt` null, `activity` `none`, `activity_until` null, and no payment days. An omitted street, house number, postal code, or city is stored as null. Payment days and `activity_until` stay beside the row, not on `StoredMapPlace`. A repeat of origin plus external id on insert returns the first row unchanged, including its tech provider, country, street, house number, postal code, city, shop name, supports, last transaction instant, `activity`, `activity_until`, and payment days. An upsert updates the fields it already updates and does not clear the timestamp, `activity`, `activity_until`, or payment days. `applySparPaymentLinkAddresses` writes only name and the four address fields. GET `/map/places` applies this SPAR split before it returns.
- **Inputs:** `insertIfNew` and `upsert` take a validated pin. `applySparPaymentLinkAddresses` takes origin, external id, name, street, houseNumber, postalCode, and city for each existing pin. `recordTransaction` takes origin, external id, an occurred-at string, and `nowMs`. `refreshActivity` takes `nowMs`. `deleteByKey` takes origin and external id. `list` takes a positive limit and an optional filter object (`origin`, `country`, `shopName`, `blockchain`, `asset`). `filters` takes an optional blockchain.
- **Returns / side effects:** `insertIfNew` reports whether it created the row. An omitted street, house number, postal code, or city is stored as null. `upsert` stores a sent country, street, houseNumber, postalCode, or city and keeps the stored part when that field is omitted. An omitted shop name is stored as null. It replaces supports only when that field is sent. `applySparPaymentLinkAddresses` counts a row only when at least one of name, street, houseNumber, postalCode, or city differs. A missing pair is skipped. The narrow update does not change shop name or country. `recordTransaction` returns a copy or undefined when the pair is missing. An unparseable `occurredAt` does not change the row. A written instant is `new Date(newMs).toISOString()`. It does not insert, does not move an equal or newer stored instant backward, and replaces a null or unparseable stored value. A parseable instant deletes stored payment days older than the 7-date window start of `nowMs` before classifying, stores its UTC date only when that date is inside that window, then stores `activity` and `activity_until` from `placeActivity`. `refreshActivity` updates only rows whose stored `activity_until` is non-null and due, deletes payment days older than the window start, and stores the new token and `until`. `deleteByKey` is true only when a row was removed and drops that row's payment days. `list` is newest first, then id descending. It never calls `refreshActivity` and never joins payment days. Predicates are AND and apply before sort and limit. `shopName` `SPAR` matches that stored brand; `others` matches every other pin, including a missing brand. A pin with support rows matches a blockchain or asset only on those rows, and a pair must be the same row. A pin with no support rows matches the hardcoded payment-link catalog. `filters` returns distinct stored countries, blockchains, and assets; shop names are not read. `close` drops the rows.
- **Used by:** Unit tests. The process uses `SqliteMapPlaceStore`.

## Function: SqliteMapPlaceStore

- **Purpose:** SQLite driver for map pins. The schema is `MAP_PLACE_SCHEMA_SQL`. Opening an older file adds `tech_provider`, `country`, `street`, `house_number`, `postal_code`, `city`, `shop_name`, `last_transaction_at`, `activity`, and `activity_until` when those columns are missing, creates `map_place_support`, `map_place_payment_day`, and their indexes if missing, and backfills `shop_name` to SPAR for origin `spar` when that column is null. It also sets a null country from the last four-digit word in a SPAR name, or from four known shop names, and does not replace a country that is already stored. Opening a file that lacks `activity` then backfills every existing row once from `last_transaction_at` at `Date.now()`: at most that one UTC day when it is inside the window, then `activity` and `activity_until`. It does not invent the other days. Every constructor open, including a file that already has the column, ends by calling `refreshActivity(Date.now())`. An upsert that omits `country`, `street`, `houseNumber`, `postalCode`, or `city` keeps that stored part. New rows store `last_transaction_at` null, `activity` `none`, `activity_until` null, and no payment days. An omitted street, house number, postal code, or city is stored as null. An upsert and a repeat insert do not clear the timestamp, `activity`, `activity_until`, or payment days. A conflicting insert does not overwrite the first row, including its address parts. `applySparPaymentLinkAddresses` writes only name, street, house_number, postal_code, and city. GET `/map/places` applies this SPAR split before it returns.
- **Inputs:** Constructor takes a SQLite filename or `:memory:`. `upsert`, `applySparPaymentLinkAddresses`, `recordTransaction`, and `deleteByKey` use the same origin and external id pair as insert. `recordTransaction` also takes `nowMs`. `refreshActivity` takes `nowMs`. `list` takes a positive limit and an optional filter object. Predicates are AND and apply before sort and limit. A pin with no support rows uses the same hardcoded payment-link catalog as the memory store. SQLite binds every value. `filters` takes an optional blockchain.
- **Returns / side effects:** Opens the file, enables foreign keys, applies the schema, and implements `MapPlaceStore`. `applySparPaymentLinkAddresses` runs `UPDATE map_place SET name = ?, street = ?, house_number = ?, postal_code = ?, city = ? WHERE origin = ? AND external_id = ?` only when the pair exists and at least one of those five values differs. It does not call upsert. The narrow update does not change shop name or country. `recordTransaction` uses the same last-instant and payment-day rules as the memory store. A parseable instant deletes stored payment days older than the 7-date window start of `nowMs` before classifying, stores its UTC date only when that date is inside that window, then stores `activity` and `activity_until` from `placeActivity`. An unparseable `occurredAt` does not change the row. A written instant is `new Date(newMs).toISOString()`. `refreshActivity` updates only rows whose stored `activity_until` is non-null and due. `list` never calls `refreshActivity` and never joins payment days. Present filter fields are AND-ed before the sort and the limit. Deleting a pin deletes its support rows and payment days. The process calls `refreshActivity(Date.now())` at startup and every 1000 ms. `close` closes the handle.
- **Used by:** The process entrypoint. The HTTP end-to-end run exercises it.

## Function: mapSubmissionBody

- **Purpose:** Build the JSON body for the BTC Map user submission. `extra_fields.source` is the pin origin. `payment_methods` is included only when the pin has them.
- **Inputs:** A stored map pin.
- **Returns / side effects:** `{ lat, lon, category, name, extra_fields }`. No I/O.
- **Used by:** `pushMapPlace`.

## Function: pushMapPlace

- **Purpose:** POST one new pin to BTC Map. A missing or blank token skips the call. A network or HTTP failure returns `failed` and does not throw. The token is not logged.
- **Inputs:** Stored pin, environment (`BTCMAP_ACCESS_TOKEN`, optional `BTCMAP_SUBMIT_URL`), and fetch. The default URL is `https://api.btcmap.org/v4/place-submissions`.
- **Returns / side effects:** `sent`, `failed`, or `skipped`. Timeout is 5000 ms.
- **Used by:** `mapRoutes` after a new insert from POST or PUT.

## Function: mapRoutes

- **Purpose:** `GET /map/places` is public and may take `origin`, `country`, `shopName`, `blockchain`, and `asset` to restrict the list. Before the public list it applies `sparPaymentLinkAddressUpdates` and `applySparPaymentLinkAddresses` for stored origin `spar` shops whose brand is SPAR: the name becomes the payment-link name and the address is street, house number, postal code, and city. The narrow update does not change shop name or country. A disabled or failed location read leaves the stored row and still returns status 200. GET does not call `refreshActivity`. A read copies the stored `activity` token and does not reclassify. `GET /map/filters` is public and returns the shop name tokens, distinct countries, the payment-link catalog merged with stored blockchains and assets, and `techProviders`. `POST /map/places` requires the ingest bearer and creates a pin at most once. `PUT /map/places` upserts a pin. `DELETE /map/places` removes a pin by origin and external id. `POST /map/places/transactions` records a transaction time on an existing pin, passes the request clock into `recordTransaction`, returns the stored `activity`, and does not call `placeActivity` or BTC Map. Maintenance happens on that write and when `activity_until` is due. The process does that maintenance at startup and every 1000 ms.
- **Inputs:** Store, optional ingest token, environment, fetch, and optional `now` (defaults to `Date.now`).
- **Returns / side effects:** GET `/places` returns `{ places }` with the stored `activity`. It applies this SPAR split before it returns. A failed fetch still returns the stored list with status 200. It never calls `refreshActivity`. GET `/filters` returns `{ shopNames, countries, blockchains, assets, techProviders }`. POST and PUT return 201 `{ created: true, id, btcmap }` or 200 `{ created: false, id, btcmap: "skipped" }`. DELETE returns 200 `{ deleted: true }` or `{ deleted: false }`. POST `/places/transactions` returns 200 `{ activity }` from the stored row or 404 `{ error: "Place not found" }` and does not call BTC Map.
- **Used by:** `createApp`, mounted at `/map`.

## Function: healthRoutes

- **Purpose:** `GET /healthz` answers `{ ok: true }` when the process is up.
- **Inputs:** None.
- **Returns / side effects:** A Hono app with one public GET. No I/O.
- **Used by:** `createApp`, mounted at `/healthz`.

## Function: welcomeRoutes

- **Purpose:** `GET /` returns a static HTML welcome page for the API host. It links `GET /map/places`, `GET /map/filters`, `GET /healthz`, and the public website. It does not read the store.
- **Inputs:** None.
- **Returns / side effects:** A Hono app with one public GET. No I/O.
- **Used by:** `createApp`, mounted at `/`.

## Function: createApp

- **Purpose:** Build the HTTP application: the welcome page, health, and the map routes.
- **Inputs:** Store, optional ingest token, environment, fetch, and an optional clock. When the clock is omitted the routes use `Date.now`.
- **Returns / side effects:** A Hono app. It does not listen and does not open a second database.
- **Used by:** The process entrypoint and the tests.
