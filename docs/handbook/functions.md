# Functions

## Function: normalizePlaceOrigin

- **Purpose:** Trim a pin origin and accept only `^[a-z0-9][a-z0-9-]{0,31}$`. A leading digit is valid. Uppercase tokens such as SPAR are invalid.
- **Inputs:** Unknown value, typically a JSON field or the `origin` query string.
- **Returns / side effects:** `{ ok: true, value }` with the trimmed origin, or `{ ok: false, error: "Place origin is invalid" }`. No I/O.
- **Used by:** `normalizeMapPlace`, `normalizeMapPlaceKey`, `mapRoutes` on `GET /map/places`, and `adminRoutes` when a public-id body includes `origin`.

## Function: normalizeExternalId

- **Purpose:** Trim a caller id and accept only a string of 1 to 80 characters with no character code below 32 and no DEL (127). A non-string, a blank trim, a longer value, or a control character is rejected.
- **Inputs:** Unknown value, typically a JSON `externalId`.
- **Returns / side effects:** `{ ok: true, value }` with the trimmed caller id, or `{ ok: false, error: "Place external id is required" }`. No I/O.
- **Used by:** `normalizeMapPlace`, `normalizeMapPlaceKey`, and `adminRoutes` when a public-id body includes `externalId`.

## Function: normalizeMapPlace

- **Purpose:** Validate a JSON body for one map pin. The body must be a JSON object whose keys are exactly origin, externalId, name, description, lat, lon, category, paymentMethods, techProvider, shopType, street, houseNumber, postalCode, city, country, supports, nostrPubkey, and revision. The first unknown key in `Object.keys` order, including the old `shopName`, is `Place field is not allowed: <key>` with `<key>` cut to its first 40 characters. Coordinates must be finite and in range, then they are rounded to six decimals. An unknown payment list becomes null instead of an error. An omitted tech provider is left unset so the store can default it. An omitted `supports` list is `[]`. Country is required, trimmed, and uppercased as an assigned ISO 3166-1 alpha-2 code. Street is required, trimmed, 1 to 120 characters, without control characters. House number is required, trimmed, and must match `^[0-9][0-9A-Za-z/ .&–-]{0,31}$`. Postal code is required and trimmed: CH and LI must be exactly four digits, other countries `^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$`. City is required, trimmed, 1 to 80 characters, without control characters, and must contain a letter. Name is required, trimmed, 1 to 80 characters, without control characters. The name must not contain the street as a whole word. It must not contain the postal code as a standalone token. Description normalises `\r\n` and lone `\r` to `\n` before any check and is then trimmed. It must be 20 to 1000 characters, may contain newlines but no other control characters, and must be longer than the trimmed name and not equal to it case-insensitively. Shop type is required and exactly `SPAR` or `Others`. `nostrPubkey` (R7) is optional until step 1b of `docs/product/shop-identity.md`; when present it must pass `isNostrPubkey`, otherwise `Place NOSTR public key is invalid`, and it is stored as given, never derived. `revision` (R8) is optional; when present it must be an integer from 1 to 9007199254740991, otherwise `Place revision is invalid`. No stored field is derived from another field.
- **Inputs:** Unknown JSON. Required fields are `origin`, `externalId`, `name`, `description`, `lat`, `lon`, `category`, `shopType`, `street`, `houseNumber`, `postalCode`, `city`, and `country`. `techProvider`, `supports`, `nostrPubkey`, and `revision` may be omitted.
- **Returns / side effects:** `{ ok: true, value, revision }` with `revision` beside the pin (undefined when omitted), or `{ ok: false, error }` with a fixed English message. First failure wins. No I/O.
- **Used by:** `mapRoutes` on `POST /map/places`, and `putPlace`, shared by `mapRoutes` and `adminRoutes` for PUT.

## Function: normalizeMapPlaceFilter

- **Purpose:** Validate the optional `country`, `shopType`, deprecated `shopName`, `blockchain`, and `asset` query strings for the public map. Omitted parameters stay off the filter. Unknown query parameters stay ignored. `country` is trimmed and uppercased. `shopType` is trimmed and must be `SPAR` or `Others`. The deprecated `shopName` query maps `SPAR` to `SPAR` and `others` to `Others` for one release and is removed in the release after the rollout. If both `shopType` and `shopName` are present and map to different types, the result is `Place shop type is invalid`. `blockchain` and `asset` are trimmed and not casefolded. A filter blockchain may be a stored payment-network name or a payment-link network such as BinancePay or KucoinPay. A filter asset may be a ticker, a prefixed ticker, or a catalog name such as ckBTC or dEURO. A support body still uses the stricter stored-pair rules.
- **Inputs:** Five optional raw query strings: country, shopType, legacy shopName, blockchain, and asset.
- **Returns / side effects:** `{ ok: true, value }` with the present filter fields, or `{ ok: false, error }` with `Place country is invalid`, `Place shop type is invalid`, `Place shop name is invalid`, or `Place support is invalid`. No I/O.
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

- **Purpose:** Merge distinct stored filter values with the hardcoded payment-link catalog for `GET /map/filters`. `shopTypes` is always `["SPAR", "Others"]`. `shopNames` is the deprecated one-release alias `["SPAR", "others"]` and is removed in the release after the rollout. `?blockchain=` limits the top-level asset list. `techProviders` always contains the full `DFX.swiss` offer and the `21.gifts` offer of Lightning and BTC.
- **Inputs:** Stored countries, blockchains, and assets, plus an optional blockchain query.
- **Returns / side effects:** `{ shopTypes, shopNames, countries, blockchains, assets, techProviders }`. No I/O.
- **Used by:** `mapRoutes` on `GET /map/filters`.

## Function: normalizeMapPlaceKey

- **Purpose:** Validate origin and external id of a pin. Extra JSON fields are ignored. The body does not need coordinates or a name.
- **Inputs:** Unknown JSON. Required fields are `origin` and `externalId`, with the same rules as `normalizeMapPlace`.
- **Returns / side effects:** `{ ok: true, value: { origin, externalId } }` or `{ ok: false, error }` with the same English messages as create. No I/O.
- **Used by:** `normalizePlaceTransaction` and `normalizeMapPlaceDelete`.

## Function: normalizeMapPlaceDelete

- **Purpose:** Validate a `DELETE /map/places` body. Allowed keys are exactly `origin`, `externalId`, and `revision` (R8); the first other key in `Object.keys` order is `Place field is not allowed: <key>` with `<key>` cut to 40 characters. `origin` and `externalId` use `normalizeMapPlaceKey`. `revision` is optional; when present it must be an integer from 1 to 9007199254740991, otherwise `Place revision is invalid`. `POST /map/places/transactions` keeps `normalizeMapPlaceKey`, which ignores other keys.
- **Inputs:** Unknown JSON. Null, an array, and a non-object are `Place origin is invalid`.
- **Returns / side effects:** `{ ok: true, value: { origin, externalId }, revision }` or `{ ok: false, error }`. No I/O.
- **Used by:** `deletePlace`, shared by `mapRoutes` and `adminRoutes`.

## Function: isNostrPubkey

- **Purpose:** Check a NIP-01 public key (R7): exactly 64 lowercase hex characters naming the x coordinate of a point on secp256k1. The x value must be below the field prime and `x³ + 7` must be a square modulo that prime (Euler's criterion). An `npub`, uppercase hex, and any other form are rejected.
- **Inputs:** Any JSON value.
- **Returns / side effects:** True or false. No I/O.
- **Used by:** `normalizeMapPlace`, and `mapRoutes` on `GET /map/places/:id` for the hex form.

## Function: npubEncode

- **Purpose:** NIP-19 `npub` (bech32, prefix `npub`) of a public key. The npub is never stored; it is computed wherever a shop id is shown.
- **Inputs:** A key accepted by `isNostrPubkey`.
- **Returns / side effects:** The 63-character `npub1…` string. No I/O.
- **Used by:** `toPublicMapPlace`, `putPlace`, and `mapRoutes` on `POST /map/places` and for the redirect of `GET /map/places/:id`.

## Function: npubDecode

- **Purpose:** Public key named by an `npub`. The string must be lowercase `npub1` plus 58 bech32 characters with a valid checksum and zero padding bits.
- **Inputs:** A path segment or any string.
- **Returns / side effects:** 64 lowercase hex characters, or null. No I/O.
- **Used by:** `mapRoutes` on `GET /map/places/:id`.

## Function: placeWriteConflict

- **Purpose:** Decide whether a place write is refused, in the order R8 and R7 fix. First the revision: once a revision is stored for the origin and external id, a write without one, or with one that is not higher, is `Stale revision`. Then the key, only when the write carries one: a row that already has a key refuses a different key with `nostrPubkey of a place cannot change`; otherwise a key reserved for another origin or external id is `nostrPubkey belongs to another place`. So when both key rules break, the stored key decides.
- **Inputs:** The stored revision, the sent revision, whether the pair has a row and that row's key, the sent key, the pair the sent key is reserved for, and the pair of the write.
- **Returns / side effects:** The 409 text, or null when the write may go ahead. No I/O.
- **Used by:** `MemoryMapPlaceStore` and `SqliteMapPlaceStore` inside `insertIfNew` and `upsert`, before anything is stored.

## Function: placeActivity

- **Purpose:** Classify a stored transaction instant and payment days into `daily`, `within7Days`, `within30Days`, `olderThan30Days`, or `none`. First match wins. `daily` is at least five distinct stored UTC dates (`YYYY-MM-DD`) that lie on the UTC date of `nowMs` or on one of the previous six UTC dates. Duplicates and strings that are not that date form or that lie outside the window are ignored. `within7Days` is a parseable instant whose age is at most `7 * 24 * 60 * 60 * 1000` ms (exactly 7 days stays here; a future instant stays here) when the row is not `daily`. `within30Days` is older than 7×24h and at most 30×24h (exactly 30 days stays here). One millisecond past 30×24h is `olderThan30Days`, not `none`. `none` is a null or unparseable instant when the row is not `daily`.
- **Inputs:** `lastTransactionAt` (`string | null`), `paymentDays` (readonly UTC date strings), and `nowMs` (maintenance clock in milliseconds).
- **Returns / side effects:** `{ activity, until }`. For `daily`, `until` is UTC midnight at the start of the fifth-newest counted day plus 7 days. For `within7Days` and `within30Days`, `until` is one millisecond after the 7-day or 30-day bound. For `olderThan30Days` and `none`, `until` is null. No I/O.
- **Used by:** `MemoryMapPlaceStore` and `SqliteMapPlaceStore` on the transaction write, when `activity_until` is due, and on `replaceById` when the activity write is `recompute`.

## Function: normalizePlaceTransaction

- **Purpose:** Validate a JSON body that records a shop transaction. `origin` and `externalId` use `normalizeMapPlaceKey` and the same error strings. Extra JSON fields other than an own property `id` are ignored. An own property `id` is `Place field is not allowed: id`, because origin and external id go through `normalizeMapPlaceKey`. Omitted `occurredAt` becomes `new Date(nowMs).toISOString()`. A present `occurredAt` must be a parseable string at most 120 seconds after `nowMs`; exactly `nowMs + 120_000` is valid and one millisecond later is not. The returned instant is canonical ISO (`new Date(parsed).toISOString()`), not the raw string. An instant whose canonical form does not start with a four-digit year, such as a negative year, is `Place transaction time is invalid`, because SQLite `julianday` cannot read it.
- **Inputs:** Unknown JSON and `nowMs`. Required fields are `origin` and `externalId`. `occurredAt` is optional.
- **Returns / side effects:** `{ ok: true, value: { origin, externalId, occurredAt } }` or `{ ok: false, error }` including `Place transaction time is invalid`. No I/O.
- **Used by:** `mapRoutes` on `POST /map/places/transactions`.

## Function: toPublicMapPlace

- **Purpose:** Strip the caller id and payment methods before a pin is shown on the public map. `id` is the shop's npub (`npubEncode` of the stored key), or null for a row without a key, which only `adminRoutes` shows; the internal UUID is never returned. The tech provider, description, shop type, street, house number, postal code, city, country, and supports stay on the public row. `shopName` is derived for one release as `'SPAR'` when `shopType` is `'SPAR'`, otherwise null, and is removed in the release after the rollout. Address parts on a public row are strings. `activity` is copied from the stored pin. A read does not reclassify. `coverPhoto` is the first stored photo as `{ url, width, height }` with an absolute `url` from `OCP_PUBLIC_BASE_URL`, or null.
- **Inputs:** A stored map pin and `OCP_PUBLIC_BASE_URL`. Public map callers pass a complete row; `adminRoutes` may pass an incomplete row.
- **Returns / side effects:** `id`, `origin`, `name`, `description`, `lat`, `lon`, `category`, `techProvider`, `shopType`, `shopName`, `country`, `street`, `houseNumber`, `postalCode`, `city`, `supports`, `activity`, and `coverPhoto`. No I/O.
- **Used by:** `mapRoutes` on `GET /map/places`, `toPublicMapPlaceDetail`, and `adminRoutes` on `GET /admin/places`.

## Function: MemoryMapPlaceStore

- **Purpose:** In-memory map store with the same insert-once, full-replace upsert, delete, `recordTransaction`, and `refreshActivity` rules as SQLite. New rows store `lastTransactionAt` null, `activity` `none`, `activity_until` null, and no payment days. Completeness: a row is complete when name, description, shop type (`SPAR` or `Others`), street, house number, postal code, city, and country are non-empty and `lastTransactionAt` is null or starts with a four-digit year and `Number.isFinite(Date.parse(...))`, which matches what SQLite `julianday` reads for the canonical ISO instants this service writes. `list` and the `countries` of `filters` use only complete rows. `listAll` returns every row, including incomplete rows, newest first with no filter or limit. A row is also incomplete without a NOSTR key (R7). Payment days and `activity_until` stay beside the row, not on `StoredMapPlace`. Key reservations and revisions stay beside the rows too and are never removed by `deleteByKey`. Every write first runs `placeWriteConflict`; a refused write stores nothing and returns `{ ok: false, error }`. A write that stores a key not yet reserved reserves it for its origin and external id. A write with a revision stores it, also when it changes nothing. A repeat of origin plus external id on insert returns the first row unchanged, except that a row without a key stores the key the write carries, including its tech provider, description, shop type, address, supports, last transaction instant, `activity`, `activity_until`, and payment days. An upsert replaces every field of the pin and does not clear the timestamp, `activity`, `activity_until`, or payment days; it keeps a stored key and adds a key to a row without one. An omitted tech provider becomes `DFX.swiss`. An omitted supports list becomes `[]`. No field is derived from another field.
- **Inputs:** `insertIfNew` and `upsert` take a validated pin and an optional revision. `recordTransaction` takes origin, external id, an occurred-at string, and `nowMs`. `refreshActivity` takes `nowMs`. `deleteByKey` takes origin, external id, and an optional revision. `findPublicByPubkey` takes a 64-character hex key. `replacePhotos` takes origin, key, prepared photos, and an optional revision. `findPublicPhoto` takes a SHA-256 hex hash. `list` takes a positive limit and an optional filter object (`origin`, `country`, `shopType`, `blockchain`, `asset`). `listAll` takes no arguments. `filters` takes an optional blockchain.
- **Returns / side effects:** `insertIfNew` and `upsert` return `{ ok: true, created, place }` or `{ ok: false, error }` with the `placeWriteConflict` text. `insertIfNew` reports whether it created the row. `upsert` replaces name, description, lat, lon, category, paymentMethods, techProvider, shopType, street, houseNumber, postalCode, city, country, and supports. `recordTransaction` returns a copy or undefined when the pair is missing. An unparseable `occurredAt` does not change the row. A written instant is `new Date(newMs).toISOString()`. It does not insert, does not move an equal or newer stored instant backward, and replaces a null or unparseable stored value. A parseable instant deletes stored payment days older than the 7-date window start of `nowMs` before classifying, stores its UTC date only when that date is inside that window, then stores `activity` and `activity_until` from `placeActivity`. `refreshActivity` updates only rows whose stored `activity_until` is non-null and due, deletes payment days older than the window start, and stores the new token and `until`. `deleteByKey` returns `{ ok: false, error: "Stale revision" }` when a stored revision is not lower than the sent one or none is sent, otherwise stores the sent revision and returns `{ ok: true, deleted }`, with `deleted` true only when a row was removed; it drops that row's payment days. `findPublicByPubkey` returns a copy of the complete row with that key, or undefined. `list` is newest complete pins first, then id descending. `listAll` is every row, including incomplete rows, newest first, with no limit. Neither calls `refreshActivity` or joins payment days. Predicates are AND and apply before sort and limit. `shopType` matches the stored enum. A pin with support rows matches a blockchain or asset only on those rows, and a pair must be the same row. A pin with no support rows matches the hardcoded payment-link catalog. `filters` returns distinct countries of complete rows, plus blockchains and assets from every row. `replacePhotos` finds the row with that key and origin, listed or not (otherwise `Place not found`), applies the revision rule of the row's pair (`Stale revision`), stores the revision, replaces the row's photos in order, and drops every file no row uses any more. `findPublicPhoto` returns a copy of a file only while a complete row uses it. `deleteByKey` also drops files no row uses any more; `upsert` keeps the photos. `close` drops the rows, reservations, revisions, and photo files.
- **Used by:** Unit tests. The process uses `SqliteMapPlaceStore`.

## Function: SqliteMapPlaceStore

- **Purpose:** SQLite driver for map pins. The schema is `MAP_PLACE_SCHEMA_SQL` (`description` and `shop_type` columns, no `shop_name` on a new database). Opening an older file adds `tech_provider`, `country`, `street`, `house_number`, `postal_code`, `city`, `description`, `shop_type`, `last_transaction_at`, `activity`, `activity_until`, and `nostr_pubkey` when those columns are missing, and creates `map_place_support`, `map_place_payment_day`, `map_pubkey_reservation`, `map_place_revision`, `map_photo`, `map_place_photo`, and their indexes if missing, including the unique index on `nostr_pubkey`, which allows several nulls. An existing leftover `shop_name` column is left in place and is never read or written. Country and shop type are not backfilled from the name or origin. Opening a file that lacks `activity` then backfills every existing row once from `last_transaction_at` at `Date.now()`: at most that one UTC day when it is inside the window, then `activity` and `activity_until`. It does not invent the other days. Every constructor open, including a file that already has the column, ends by calling `refreshActivity(Date.now())`. Completeness: a row is complete when name, description, shop_type in (`SPAR`, `Others`), street, house_number, postal_code, city, and country are non-null and non-empty, `nostr_pubkey` is not null (R7), and `last_transaction_at` is null or `julianday(last_transaction_at) IS NOT NULL`. `insertIfNew`, `upsert`, and `deleteByKey` each run in one transaction: they read the stored revision and, for a sent key, its reservation, apply `placeWriteConflict` (the delete applies only its revision rule), then reserve a new key, store the revision, and write the row, with the same results as `MemoryMapPlaceStore`. Photos live in `map_photo` (each distinct file once by hash) and `map_place_photo` (place, position 0 to 9, hash, caption); lists load them in chunks of at most 500 place ids, as supports. `replacePhotos` runs in one transaction with the same rules as the memory store and deletes every `map_photo` row no `map_place_photo` row uses; `deleteByKey` does the same after the cascade removes the place's photo rows. `findPublicPhoto` returns a file only while a complete row uses it. `list` and the `countries` of `filters` use only complete rows. `listAll` returns every row, including incomplete rows, newest first with no filter or limit. An upsert is a full replace of every pin field. New rows store `last_transaction_at` null, `activity` `none`, `activity_until` null, and no payment days. An upsert and a repeat insert do not clear the timestamp, `activity`, `activity_until`, or payment days. A conflicting insert does not overwrite the first row. `recordTransaction` and `deleteByKey` also work on incomplete rows.
- **Inputs:** Constructor takes a SQLite filename or `:memory:`. `upsert`, `recordTransaction`, and `deleteByKey` use the same origin and external id pair as insert; `insertIfNew`, `upsert`, and `deleteByKey` also take an optional revision. `findPublicByPubkey` takes a 64-character hex key. `replacePhotos` takes origin, key, prepared photos, and an optional revision. `findPublicPhoto` takes a SHA-256 hex hash. `recordTransaction` also takes `nowMs`. `refreshActivity` takes `nowMs`. `list` takes a positive limit and an optional filter object; `listAll` takes no arguments. Predicates are AND and apply before sort and limit. A pin with no support rows uses the same hardcoded payment-link catalog as the memory store. SQLite binds every value. `filters` takes an optional blockchain.
- **Returns / side effects:** Opens the file, enables foreign keys, applies the schema, and implements `MapPlaceStore`. `recordTransaction` uses the same last-instant and payment-day rules as the memory store. A parseable instant deletes stored payment days older than the 7-date window start of `nowMs` before classifying, stores its UTC date only when that date is inside that window, then stores `activity` and `activity_until` from `placeActivity`. An unparseable `occurredAt` does not change the row. A written instant is `new Date(newMs).toISOString()`. `refreshActivity` updates only rows whose stored `activity_until` is non-null and due. `list` returns complete rows; `listAll` returns every row, including incomplete rows, newest first and without a limit. Neither calls `refreshActivity` or joins payment days. Present filter fields are AND-ed before the sort and the limit, including `shop_type = ?`. Support rows for lists are loaded in chunks of at most 500 place ids. Deleting a pin deletes its support rows and payment days. The process calls `refreshActivity(Date.now())` at startup and every 1000 ms. `close` closes the handle.
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
- **Used by:** `mapRoutes` after a new POST insert, and `putPlace` after a new PUT insert. `adminRoutes` reaches that call only when a no-id PUT inserts a row. A public-id replace does not call BTC Map.

## Function: mapRoutes

- **Purpose:** `GET /map/places` is public and may take `origin`, `country`, `shopType`, deprecated `shopName`, `blockchain`, and `asset` to restrict the complete-row list. A read copies the stored `activity` token and does not reclassify. `GET /map/filters` is public and returns `shopTypes`, the deprecated `shopNames` alias, distinct countries of complete rows, the payment-link catalog merged with stored blockchains and assets, and `techProviders`. `POST /map/places` requires the ingest bearer and creates a pin at most once. `PUT /map/places` is a full replace. `DELETE /map/places` removes a pin by origin and external id. `PUT /map/places/photos` replaces a shop's photos and `GET /map/photos/:file` serves a photo of a listed shop. `GET /map/places/:id` serves one listed shop with its photos. `POST /map/places/transactions` records a transaction time on an existing pin, passes the request clock into `recordTransaction`, returns the stored `activity`, and does not call `placeActivity` or BTC Map. Maintenance happens on that write and when `activity_until` is due. The process does that maintenance at startup and every 1000 ms.
- **Inputs:** Store, optional ingest token, environment, fetch, `publicBaseUrl` for photo URLs, and optional `now` (defaults to `Date.now`).
- **Returns / side effects:** GET `/places` returns `{ places }` with the stored `activity`. It never calls `refreshActivity`. GET `/filters` returns `{ shopTypes, shopNames, countries, blockchains, assets, techProviders }`. POST and PUT return 201 `{ created: true, id, btcmap }` or 200 `{ created: false, id, btcmap: "skipped" }`, or 409 `Stale revision`, `nostrPubkey of a place cannot change`, or `nostrPubkey belongs to another place`. DELETE returns 200 `{ deleted: true }` or `{ deleted: false }`, or 409 `Stale revision`. GET `/places/:id` returns 200 `{ place }` with `photos`, 301 from the hex key to the npub, 404 `{ error: "Place not found" }`, or 503 `{ error: "Places are unavailable" }`. PUT `/places/photos` returns 200 `{ photos, skipped }`, or 413, 400, 404, or 409 as listed in `endpoints.md`. GET `/photos/:file` returns the file, 404 `{ error: "Photo not found" }`, or 503. POST `/places/transactions` returns 200 `{ activity }` from the stored row or 404 `{ error: "Place not found" }` and does not call BTC Map.
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

- **Purpose:** Build the HTTP application: the welcome page, health, map routes, and the `/admin` mount. Admin answers 503 when either its keys or host is missing.
- **Inputs:** Store, optional ingest token, environment, fetch, optional `adminKeys` and `adminHost`, `publicBaseUrl` (the validated `OCP_PUBLIC_BASE_URL`), and an optional clock. When the clock is omitted the routes use `Date.now`.
- **Returns / side effects:** A Hono app. It does not listen and does not open a second database.
- **Used by:** The process entrypoint and the tests.

## Function: parseAdminPublicKeys

- **Purpose:** Parse `OCP_ADMIN_PUBLIC_KEYS` into the devices allowed to call `/admin`. The value is split on `\n` or `\r\n`. A blank line is skipped. A line whose first non-whitespace character is `#` is a comment and is skipped. Every other line is three fields: `ed25519`, the base64 of the raw 32-byte public key, and a name, or `ssh-ed25519`, the base64 of the OpenSSH wire blob, and a name. The wire blob is a uint32 length, the text `ssh-ed25519`, a uint32 length, and the 32-byte key, and nothing after that. The name matches `^[A-Za-z0-9._@-]{1,64}$` and is unique. Base64 may be padded or unpadded.
- **Inputs:** The environment string. Line numbers are 1-based and count every line, including blanks and comments.
- **Returns / side effects:** The keys in file order. Empty when every line is blank or a comment. A bad line throws `OCP_ADMIN_PUBLIC_KEYS line <N>: malformed key`. A repeated name throws `OCP_ADMIN_PUBLIC_KEYS line <N>: duplicate key name`. The same key material under a second name throws `OCP_ADMIN_PUBLIC_KEYS line <N>: duplicate key`, because the replay key is the key name plus the nonce. Nothing is returned when it throws. No I/O.
- **Used by:** The process entrypoint before it listens.

## Function: decodeBase64

- **Purpose:** Decode strict standard base64. Padded and unpadded input is accepted. A bad alphabet, a length of 4n+1, or padding that does not match the body is rejected.
- **Inputs:** One base64 token.
- **Returns / side effects:** Decoded bytes, or undefined when the token is invalid. No I/O.
- **Used by:** `parseAdminPublicKeys` for public keys and `verifyAdminRequest` for signatures.

## Function: canonicalString

- **Purpose:** Build the UTF-8 string an admin signature covers. The fields are `OCP-ADMIN-v1`, the method in upper case, the host, the path plus the query as given (the server passes the pathname plus search of the parsed request URL, so a lone trailing `?` is dropped), the decimal unix timestamp, the nonce, and the lowercase hex SHA-256 of the raw body. An empty body hashes as zero bytes (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). The fields are joined with `\n`. There is no trailing newline. The key name is not a field.
- **Inputs:** Method, host, path with query, unix seconds, the nonce (16 to 64 characters of `[A-Za-z0-9_-]`), and the raw body bytes.
- **Returns / side effects:** The string the device signs and the server rebuilds. Throws `Admin timestamp must be an integer` when the timestamp is not a safe integer. Throws `Admin nonce is invalid` when the nonce does not match. No I/O.
- **Used by:** `signAdminRequest` and `verifyAdminRequest`.

## Function: signAdminRequest

- **Purpose:** Sign one admin request with an Ed25519 private key. The host is the name the server was configured with, not a header the client picked. The signature is standard base64 of the 64-byte signature over the UTF-8 canonical string. The key name is sent as `OCP-Admin-Key` and is not part of that string. The nonce is part of the signed string and is sent as `OCP-Admin-Nonce`. When the nonce is omitted, 16 random bytes are generated as base64url.
- **Inputs:** Method, host, path with query, unix seconds, raw body, PKCS8 Ed25519 private key, key name, and an optional nonce.
- **Returns / side effects:** The headers `OCP-Admin-Key`, `OCP-Admin-Timestamp` (the decimal timestamp), `OCP-Admin-Signature`, and `OCP-Admin-Nonce`. Throws `Admin timestamp must be an integer` when the timestamp is not a safe integer. Throws `Admin nonce is invalid` when a given nonce does not match. Does not record a replay. No other I/O.
- **Used by:** A device that calls `/admin`. `scripts/ocp-admin.mjs` builds the same four headers. The server checks them with `verifyAdminRequest`.

## Function: verifyAdminRequest

- **Purpose:** Accept one admin request only when the nonce matches, the key name is known, the timestamp header is an integer within 60 seconds of the server clock (the difference may be 60 and must not be 61), and the signature verifies over `canonicalString` for the configured host, the method, the path plus query, the nonce, and the raw body. A missing or malformed nonce returns false before any signature work. A nonce already stored for that key is rejected. Expired entries (expiry strictly before the current unix second) are removed at the start of every call. The replay key is `<keyName>\n<nonce>`, not the signature. On success that key is stored until `timestamp + 60`. Every failure returns false and does not store the nonce. The host argument is the server config, never the request `Host` header.
- **Inputs:** Allowed keys, the header values including the nonce, method, host, path with query, raw body, current unix seconds, and the process replay map.
- **Returns / side effects:** True only when the request is fresh, signed by an allowed key, and not a replay. False for a missing or malformed nonce, a missing or unknown key, a timestamp that is not an integer, a timestamp outside the 60-second window, a bad or wrong-length signature, a signature that does not verify, or a reused nonce. Does not throw. Updates the replay map only after a successful check.
- **Used by:** `adminRoutes` on every `/admin` request once admin is configured.

## Function: adminRoutes

- **Purpose:** Signed maintenance of pins for any origin, mounted at `/admin`. When no key is loaded or the host is blank, every request returns 503 `{ error: "Admin is not configured" }` and the body is not checked. Otherwise a body above 64 KiB returns 413 `{ error: "Payload too large" }` before the signature is checked. The raw body is read once, `verifyAdminRequest` runs against the trimmed configured host and the path plus query of the request URL, and a failure returns 401 `{ error: "Unauthorized" }`. `GET /places` lists every stored pin, including incomplete rows, newest first. Each item is the public place plus `complete` and `problems` from one `placeProblems` call. The caller id and payment methods are omitted. `PUT /places` and `DELETE /places` parse those same bytes as JSON (empty or invalid JSON is null) and call `putPlace` and `deletePlace`. The request `Host` header is not the signed host.
- **Inputs:** Store, environment, fetch, the allowed keys, the configured host, `publicBaseUrl` for photo URLs in the list, and an optional clock in milliseconds (default `Date.now`). One replay map lives for the life of the app.
- **Returns / side effects:** A Hono app. GET returns 200 `{ places }`. PUT and DELETE return the status and body of `putPlace` and `deletePlace`. A valid signature for an unknown path falls through as 404. No second database.
- **Used by:** `createApp`, mounted at `/admin`.

## Function: putPlace

- **Purpose:** Full replace of one map pin, or insert it when the origin and external id are new. Validation, the store write, and the BTC Map call are the same as `PUT /map/places`, including the key rules (R7) and the revision (R8). A new row is posted to BTC Map only when this call inserts it. An update does not call BTC Map. A rejected body leaves the stored pin unchanged. This function does not check the ingest bearer or the admin signature.
- **Inputs:** Store, BTC Map environment, fetch, and the request JSON. Null, an array, and a non-object are invalid.
- **Returns / side effects:** 400 `{ error }` with the validator message, 409 `{ error }` with `Stale revision`, `nostrPubkey of a place cannot change`, or `nostrPubkey belongs to another place` (nothing stored), 201 `{ created: true, id, btcmap }` when the row is new, or 200 `{ created: false, id, btcmap }` when the pair already existed. `id` is the npub, or null for a place without a key. `btcmap` is `sent`, `failed`, or `skipped`.
- **Used by:** `mapRoutes` on `PUT /map/places` after the ingest check, and `adminRoutes` on `PUT /admin/places` after the signature check.

## Function: deletePlace

- **Purpose:** Remove one map pin by origin and external id. Validation is `normalizeMapPlaceDelete`: exactly `origin`, `externalId`, and an optional `revision`. A missing pair is still 200 with `{ deleted: false }`, and its revision is stored. The pair's key reservations and revision stay. This call does not contact BTC Map. This function does not check the ingest bearer or the admin signature.
- **Inputs:** Store, and the request JSON. Null, an array, and a non-object are invalid. Required fields are `origin` and `externalId`.
- **Returns / side effects:** 400 `{ error }` with the validator message, 409 `{ error: "Stale revision" }`, or 200 `{ deleted: true }` or `{ deleted: false }`. A true result means a row was removed.
- **Used by:** `mapRoutes` on `DELETE /map/places` after the ingest check, and `adminRoutes` on `DELETE /admin/places` after the signature check.

## Function: stripPhotoMetadata

- **Purpose:** Remove metadata from a shop photo by allow-list, at byte level, and read its displayed size. Nothing is decoded or re-encoded. JPEG keeps an `APP0` only as a plain JFIF header rewritten with a 0×0 thumbnail, an `APP14` only when it starts with `Adobe` and has at least 12 bytes (cut to those 12), drops every other `APPn` (EXIF, XMP, MPF, ICC, maker data) and every `COM`, writes back a minimal `APP1` EXIF with only the orientation when the original held 2 to 8, keeps only the image markers (`SOFn`, `DHT`, `DAC`, `DQT`, `DRI`, `DNL`, `DHP`, `EXP`, `SOS` with the entropy-coded data of every scan, and the length-free `TEM` and `RSTn`), drops every other marker (`JPG`, `JPGn`, reserved), and cuts every byte after the main image's `EOI`. PNG keeps `IHDR`, `PLTE`, `IDAT`, `IEND`, `tRNS`, `gAMA`, `cHRM`, `sRGB`, `cICP`, `sBIT`, `pHYs` and `bKGD`, rebuilds each with a fresh CRC, drops a fixed-size chunk of another length (`gAMA` 4, `cHRM` 32, `sRGB` 1, `cICP` 4, `pHYs` 9, `sBIT` 1 to 4, `bKGD` 1, 2 or 6) and a `tRNS` that does not fit the colour type, keeps every ancillary chunk and `PLTE` once and only before the first `IDAT`, writes `IEND` empty and cuts after it. WebP keeps `VP8X` as the first chunk, one `ALPH` after it and before the frame, and the first `VP8 ` or `VP8L` frame, rebuilds each from its declared size with a zero pad byte, keeps only the alpha flag of `VP8X` with its reserved bytes zeroed, rewrites the RIFF size and cuts after the RIFF end. Bytes inside a kept segment, such as DQT or DHT tables, are copied as they are.
- **Inputs:** The type read from the magic bytes and the decoded file.
- **Returns / side effects:** `{ ok: true, bytes, width, height }`, where a JPEG with orientation 5 to 8 has width and height swapped; `{ ok: false, error: "unreadable" }` when markers or chunks do not walk cleanly to the end (a segment or chunk past the file end, no `EOI` or `IEND`, no `SOF` or frame, a `SOF` under 8 bytes, `IHDR` not first, repeated or not 13 bytes, a `PLTE` that is not 1 to 256 entries of 3 bytes, a `VP8X` that is not the first chunk or not exactly 10 bytes, a `VP8 ` frame without its start code or a `VP8L` frame without its signature, a WebP chunk past the RIFF end); `{ ok: false, error: "animated" }` for a PNG with `acTL` or a WebP with `ANIM`, `ANMF` or the `VP8X` animation flag. No I/O.
- **Used by:** `preparePhoto`.

## Function: photoTypeOf

- **Purpose:** Name the file type from the magic bytes: `FF D8 FF` is JPEG, the PNG signature is PNG, `RIFF`…`WEBP` is WebP.
- **Inputs:** The decoded file.
- **Returns / side effects:** `image/jpeg`, `image/png`, `image/webp`, or null. No I/O.
- **Used by:** `preparePhoto`, which requires it to equal the sent `contentType`.

## Function: photoExtension

- **Purpose:** File extension of a stored photo type in `/map/photos/{sha256}.{ext}`, so each file has exactly one URL.
- **Inputs:** A stored content type.
- **Returns / side effects:** `jpg`, `png`, or `webp`. No I/O.
- **Used by:** `toPublicMapPlace`, `toPublicMapPlaceDetail`, and `mapRoutes` on `PUT /map/places/photos` and `GET /map/photos/:file`.

## Function: normalizePhotoUpload

- **Purpose:** Validate the envelope of a `PUT /map/places/photos` body. Allowed top-level keys are exactly `origin`, `nostrPubkey`, `revision`, and `photos`; allowed photo keys are `contentType`, `data`, and `caption`. A malformed envelope is rejected as a whole and nothing is stored.
- **Inputs:** Unknown JSON.
- **Returns / side effects:** `{ ok: true, value: { origin, nostrPubkey, revision, photos } }` or `{ ok: false, error }` with `Photo upload is invalid` (not an object), `Photo upload field is not allowed: <key>`, `Place origin is invalid`, `Place NOSTR public key is invalid` (missing or not `isNostrPubkey`), `Place revision is invalid`, `Photos must be a list of at most 10`, `Photo entry must be an object`, or `Photo field is not allowed: <key>`. No I/O.
- **Used by:** `mapRoutes` on `PUT /map/places/photos`.

## Function: preparePhoto

- **Purpose:** Check one photo, remove its metadata with `stripPhotoMetadata`, and hash the stripped bytes. `contentType` must be `image/jpeg`, `image/png`, or `image/webp`; `data` strict base64 of at most 1 048 576 decoded bytes; the magic bytes must equal `contentType`; width and height must be 1 to 4096; `caption` is optional, 1 to 200 characters without control characters.
- **Inputs:** One photo entry from `normalizePhotoUpload` and its 0-based index.
- **Returns / side effects:** `{ ok: true, photo: { sha256, contentType, width, height, data, caption } }`, with `caption` null when unset and `sha256` over the stripped bytes, or `{ ok: false, error }` with a sentence that numbers the photo from 1: `Photo N is not a JPEG, PNG or WebP image`, `is not valid base64`, `is larger than 1 MiB`, `caption is invalid`, `does not match its content type`, `is animated`, `could not be read`, or `must be 1 to 4096 pixels wide and high`. No I/O.
- **Used by:** `mapRoutes` on `PUT /map/places/photos`; a failing photo is reported in `skipped` and the others are stored.

## Function: parsePublicBaseUrl

- **Purpose:** Validate `OCP_PUBLIC_BASE_URL`: an `https://` origin without path, query, credentials, or trailing slash, in lowercase as `URL.origin` writes it.
- **Inputs:** The environment value.
- **Returns / side effects:** The origin, or null. No I/O.
- **Used by:** The process entrypoint, which refuses to start on null and passes the origin to `createApp`.

## Function: publicPhoto

- **Purpose:** Turn a stored photo reference into the public form, so every answer builds photo URLs the same way: `url` is `<OCP_PUBLIC_BASE_URL>/map/photos/{sha256}.{jpg|png|webp}`, never built from the request's `Host` header.
- **Inputs:** A stored photo and `OCP_PUBLIC_BASE_URL`.
- **Returns / side effects:** `{ url, width, height, caption }`, `caption` null when unset. No I/O.
- **Used by:** `toPublicMapPlace` (cover), `toPublicMapPlaceDetail`, and `mapRoutes` on `PUT /map/places/photos`.

## Function: toPublicMapPlaceDetail

- **Purpose:** One shop for `GET /map/places/{npub}`: the `toPublicMapPlace` entry plus `photos`, every stored photo in display order as `{ url, width, height, caption }` with an absolute `url` from the base URL and `caption` null when unset.
- **Inputs:** A complete stored pin and `OCP_PUBLIC_BASE_URL`.
- **Returns / side effects:** The detail object. No I/O.
- **Used by:** `mapRoutes` on `GET /map/places/:id`.

## Function: placeProblems

- **Purpose:** List why the public map hides a stored pin. This is the completeness rule of `MemoryMapPlaceStore` and the source of `complete` and `problems` on `GET /admin/places`. `SqliteMapPlaceStore` applies the same rule in SQL (`COMPLETE_PLACE_SQL`) for its public list. A row is complete when name, description, street, house number, postal code, city, and country are non-empty, shop type is `SPAR` or `Others`, a NOSTR key is stored, and `lastTransactionAt` is null or starts with a four-digit year and `Number.isFinite(Date.parse(...))`, which matches what SQLite `julianday` reads for the canonical ISO instants this service writes. The messages, in that order, are `name is empty`, `description is empty`, `street is empty`, `houseNumber is empty`, `postalCode is empty`, `city is empty`, `country is empty`, `shopType must be SPAR or Others`, `lastTransactionAt is not a valid instant`, and `nostrPubkey is missing`. Only the failures are included.
- **Inputs:** A stored pin, including an incomplete row.
- **Returns / side effects:** The problem strings in check order, or `[]` when the pin is complete. No I/O. The public list treats a pin as complete when this list is empty.
- **Used by:** `MemoryMapPlaceStore` completeness check, and `adminRoutes` on `GET /admin/places`.
