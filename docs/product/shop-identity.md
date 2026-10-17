# Shop identity, photos and shop page

Status: **specified, not implemented**. Nothing here changes runtime behaviour
yet. A change that builds a part of this adds its routes to the
[handbook](../handbook/endpoints.md), its columns and tables to
[map-place.sql](../schema/map-place.sql) and requirement R7 to
[place-requirements.md](place-requirements.md) in that same change.

Every shop is registered with a NOSTR public key. That key is the shop's
identifier everywhere: in the API, in the public page
`https://opencryptopay.io/{npub}`, and in the routes that address a shop. The
page shows everything the API knows about the shop, including its photos. The
API stores the photos and serves them.

OpenCryptoPay does not hold NOSTR keys, does not sign anything and does not
publish or maintain NOSTR profiles. The source that registers a shop owns its
identity. Whether that identity has a profile, and whether it is kept up to
date, does not matter to OpenCryptoPay: the key is used as a unique id.

21.gifts gives each of its shops such an identity and maintains its profile,
see [21gifts/api `docs/shop-identity.md`](https://github.com/21gifts/api/blob/develop/docs/shop-identity.md).
It sends that key here when it registers the shop, so a 21.gifts shop has the
same npub on both platforms.

"Shop" means one place in the public list of `GET /map/places`, as in
[place-requirements.md](place-requirements.md).

## R7 NOSTR identity (new hard requirement)

Every shop must state a NOSTR public key:

- Field `nostrPubkey` in `POST` and `PUT /map/places`: exactly 64 lowercase hex
  characters, the x-only secp256k1 public key from NIP-01. It must be a valid
  point on the curve. An `npub` string, uppercase hex or any other form is
  rejected.
- It is required. A body without it is rejected with **400** and nothing is
  stored, as in R6. It is never defaulted, generated or derived by the API.
- It is unique across all shops of all sources. A key that already belongs to
  another place is rejected with **409**
  `{ "error": "nostrPubkey belongs to another place" }`.
- It is fixed once stored. A `PUT` for the same `origin` + `externalId` with a
  different key is rejected with **409**
  `{ "error": "nostrPubkey of a place cannot change" }`. To move a shop to a new
  key, the source deletes the place and registers it again; the old URL then
  stops working.
- `nostrPubkey` is added to `ALLOWED_PLACE_KEYS`.
- A stored row without `nostrPubkey` is not complete. `COMPLETE_PLACE_SQL`
  requires it, so such a row stays out of every public response, in the same
  way PR #22 handles the other fields. Existing rows become visible again when
  their source sends them with a key.

The npub is not stored. It is `nip19.npubEncode(nostrPubkey)` wherever it is
shown.

### Storage

`map_place` gains `nostr_pubkey TEXT` with a unique index. It is added by the
existing startup `ALTER TABLE ADD COLUMN` path and stays nullable in the
database only for old rows; the write path never stores a null.

`origin` + `externalId` stay the source's own key for idempotent writes. Every
public response and every new route uses the NOSTR key instead. The internal
UUID no longer appears in public JSON.

## R8 Photos

### Delivery by the source

New endpoint `PUT /map/places/photos`, same bearer as the other write routes
(`OCP_PLACE_INGEST_TOKEN`).

```json
{
  "nostrPubkey": "<64 hex>",
  "photos": [{ "contentType": "image/jpeg", "data": "<base64>", "caption": "Front" }]
}
```

- The shop is addressed by its `nostrPubkey`. An unknown key gets **404**
  `{ "error": "Place not found" }`.
- `photos` replaces the whole photo list of that shop. An empty array removes
  every photo. Order is the order shown; the first photo is the cover.
- At most 10 photos per shop.
- Photos are separate from `PUT /map/places`, so a source does not resend
  megabytes on every text change.
- Allowed keys: `nostrPubkey`, `photos`; per photo `contentType`, `data`,
  `caption`. Any other key rejects the request, as in R6.
- The route accepts a body of up to 15 MiB. Larger bodies get **413**.
- The whole list is checked first. One bad photo rejects the request with
  **400** and stores nothing.
- Response **200** `{ "photos": [ { "url", "width", "height", "caption" } ] }`.

Rules per photo, the same limits 21.gifts applies to its own uploads:

- `contentType` is `image/jpeg`, `image/png` or `image/webp`.
- `data` is strict base64. The decoded size is at most 1 048 576 bytes.
- The file type is read from the magic bytes and must equal `contentType`.
- Width and height are read from the file header. Each is between 1 and 4096.
- `caption` is optional, 1–200 characters, no control characters.

Errors are `{ "error": "<sentence>" }`, for example
`Photo 3 is not a JPEG, PNG or WebP image` or `Photo 2 is larger than 1 MiB`.

### Metadata removal

The API removes metadata before storing. It does not rely on the source
having re-encoded the image, because a phone photo can carry its GPS position:

- JPEG: drop `APP1` (EXIF, XMP), `APP13` and `COM` segments. Keep `APP0`,
  `APP2` (ICC profile) and the image data.
- PNG: drop `eXIf`, `tEXt`, `zTXt`, `iTXt` and `tIME` chunks.
- WebP: drop the `EXIF` and `XMP ` chunks and clear their flags in `VP8X`.

This is a byte-level cut, not a re-encode, so it needs no image library. The
stored bytes are the stripped bytes.

### Storage and URL

- `map_photo (sha256 TEXT PRIMARY KEY, content_type, width, height, data BLOB)`
  holds each distinct file once. `sha256` is the hash of the stripped bytes.
- `map_place_photo (place_id, position, sha256, caption)` with primary key
  `(place_id, position)`, position 0–9, foreign key to `map_place` with
  `ON DELETE CASCADE`.
- `PUT /map/places` keeps the photos. `DELETE /map/places` removes them. A
  `map_photo` row that no shop uses any more is deleted in the same
  transaction.
- Public URL: `GET /map/photos/{sha256}.{jpg|png|webp}`.
  - `Cache-Control: public, max-age=31536000, immutable`, CORS `*`.
  - A new photo has a new hash and therefore a new URL, so a replaced photo
    never stays stale in a cache.
  - The file is served only while a shop in the public list uses it.
    Otherwise **404**.

## Public API

### `GET /map/places`

- `id` is the shop's npub. The internal UUID is no longer returned.
- New field `coverPhoto`: `null`, or `{ "url", "width", "height" }` for the
  first photo.

### `GET /map/places/{npub}`

New. No authentication, CORS `GET`, `Cache-Control: public, max-age=60`.

| Request                                   | Response                                        |
| ----------------------------------------- | ----------------------------------------------- |
| npub of a shop in the public list         | **200** `{ "place": PublicMapPlaceDetail }`     |
| 64 lowercase hex of such a shop           | **301** to `/map/places/{npub}`                 |
| anything else, including an unlisted shop | **404** `{ "error": "Place not found" }`        |
| store failure                             | **503** `{ "error": "Places are unavailable" }` |

`PublicMapPlaceDetail` is the list entry plus `photos`: an array in display
order, each `{ "url", "width", "height", "caption" }` with `caption` `null`
when unset.

## Shop page on opencryptopay.io

The website is static HTML on an Apache host. The page needs a small amount
of server-side code so that a shared link shows the shop's name and photo.

- **Route:** a rewrite in `.htaccess` sends `^npub1[02-9ac-hj-np-z]{58}$` to
  `shop.php`. A trailing slash gets a 301 to the path without it, because the
  pages load assets by relative path. No existing file or folder starts with
  `npub1`.
- **Hex:** `^[0-9a-f]{64}$` is passed to the API; on its 301 the page answers
  with a 301 to `/{npub}`.
- **Rendering:** `shop.php` calls `GET /map/places/{npub}` (production or dev
  API by host name, as `ocp-places.js` does) with a 3-second timeout and
  writes into the HTML:
  - `<title>`, `description`, `og:title`, `og:description`, `og:image` (cover
    photo, otherwise the site OG image), `twitter:*`;
  - `<link rel="canonical" href="https://opencryptopay.io/{npub}">`;
  - JSON-LD `LocalBusiness` with name, address, geo and image.
- **Statuses:** API 404 → HTTP 404 with a shop-not-found page. API 503 or
  timeout → HTTP 503 with a retry message, never a blank page.
- **Content:**
  - photo gallery: grid, opens full screen, keyboard and swipe navigation;
  - name and description;
  - full address with a "Directions" link to OpenStreetMap;
  - small MapLibre map with one pin, same tiles as the home page;
  - shop type, tech provider, accepted blockchains and assets;
  - activity in words, for example "Payments in the last 7 days";
  - the npub with a copy button and a link "Open in NOSTR" to
    `https://njump.me/{npub}`. The page reads nothing from NOSTR; what that
    link shows is up to the identity's owner.
- **Check before building:** a probe `.php` file on the dev host must return
  rendered output. If the host does not run PHP, the same page is built as a
  worker in front of the site instead, with the same contract.
- The page uses root-absolute asset paths and copies the shared nav and
  footer, as every page does today.
- Baseline: `baselines/website-shop.png` at 1440 px, rendered against a fixed
  sample shop, so live data never changes it.

## Map and table

- **Map pin:** the popup shows the cover photo (if any), name, category and a
  "Details →" link to `/{npub}`. A click on the pin opens the popup, not the
  page directly, so a phone user can read the popup first.
- **Table** (`stores.html`): the name is a link to `/{npub}`.
- **CSV export:** keeps the visible text of each cell and adds a column `URL`
  with `https://opencryptopay.io/{npub}`.

## Sources

- **21.gifts:** sends the shop's `nostrPubkey` with every place `PUT`, and
  after each successful `PUT` sends the shop note's photos (up to 10, in note
  order) to `PUT /map/places/photos`. It generates and maintains those
  identities itself.
- **DFX.swiss (SPAR):** must create one NOSTR key pair per SPAR shop before
  its next import, keep the secret keys on its side, and send each public key
  as `nostrPubkey`. Photos arrive through the same photo endpoint. Until then
  its shops stay out of the public list.
- Any further source follows the same rules. There is no source without a
  key and no key that OpenCryptoPay creates.

## Order of work

1. R7: `nostrPubkey` required and unique, `id` = npub, `GET /map/places/{npub}`
   without photos. Before this deploys, every source must send keys, or its
   shops leave the public list.
2. R8: photo endpoint, photo route, metadata removal, `coverPhoto` and
   `photos`.
3. Website: shop page, map and table links.
4. Sources: 21.gifts key and photo push; DFX.swiss keys for SPAR.

Steps 1 and 2 are each one pull request with handbook entries, e2e tests and
the 100% coverage gate, as in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Not part of this

- Generating, storing or rotating NOSTR keys in OpenCryptoPay.
- Publishing or reading NOSTR profiles, notes or relay lists.
- NIP-05 on `opencryptopay.io`.
- A shop owner uploading or editing photos directly.
- Thumbnails generated on the server.
