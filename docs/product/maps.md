# Place maps

Where a map of places is known to be shown, checked on 2026-10-23. This is an
inventory of clients, not a proof that no other client exists, and not the API
reference. The commits below are the branch tips on that date.

The street map is OpenFreeMap Liberty drawn with MapLibre. The other sections
are different maps and are named as such. How five of these clients compared
on 2026-10-12 is [map-comparison.md](map-comparison.md).

## Street map

### OpenCryptoPay website

Repository: `openCryptoPay/landingPage`.

On `opencryptopay.io`, `www.opencryptopay.io`, `dev.opencryptopay.io`, and
`www.dev.opencryptopay.io`, the homepage replaces the embedded Google My Map
with the street map of the published place list. Any other hostname keeps the
Google My Map. The homepage opens on the map. A control on the same field
switches to a table of the same places. The production hostnames call
`https://api.opencryptopay.io`. The dev hostnames call
`https://dev-api.opencryptopay.io`.

`develop` (`738586ca013cfb19e23013963e12eb816e9742a2`) shows that same street
map on `stores.html`, with the same hostname gate. That page opens on the map
and can switch to the table. The navigation lists Stores after Ecosystem.
`shop.php` draws one pin for the shop on the page, at zoom 15, from
coordinates already written into the page. It does not request the place list
in the browser. `stores.html` and `shop.php` are not on `main`
(`f5b2316540cb59f37ee1f5b8ed7cd300865a875a`). The homepage street map and the
hostname gate are on `main`.

### DFX website

Repository: `DFXswiss/landing-page`.

The homepage draws the street map of published places whose `techProvider` is
exactly `DFX.swiss`. It does not send a country query. The table still has a
country column. It opens on the map when the map starts, and a control
switches to a table of the same places.
`dfx.swiss` and `www.dfx.swiss` call `https://api.opencryptopay.io`.
`dev.dfx.swiss`, `www.dev.dfx.swiss`, and every other hostname call
`https://dev-api.opencryptopay.io`.

That page is on `develop` (`e798abfa5b56d8a2b7fd1ec4c9162d1a1a535375`). It is
not on `main` (`05ab7bacacf599670c3c76796257544ec6a9a5f7`).

### RealUnit website

Repository: `RealUnitCH/web`.

`/pay/` is the German page and `/pay/en/` is the English page. Both draw the
street map and request
`GET /map/places?blockchain=Ethereum&asset=ZCHF` on
`https://api.opencryptopay.io`. The homepage does not link to either page.
The pages are on `develop` (`d347dee69d15147bd3d5b442decf4d0a59384dc9`). They
are not on `main` (`ad4271104bfa402cadb995f1160a5c0d0de7b660`).

### 21.gifts homepage

Repository: `21gifts/app`.

The homepage on `develop` (`1f6adf9623af1c58fa2405693c29444bc47a5558`) draws
the street map under the hero and before How it works. It keeps published
places whose `techProvider` is exactly `21.gifts`. A country selection is sent
as the `country` query. It opens on the map, and a control switches to a table
of the same places. `21.gifts` and `www.21.gifts` call
`https://api.opencryptopay.io`. Every other hostname calls
`https://dev-api.opencryptopay.io`. This homepage map is not on `main`
(`90c84c65f974349c74715b5838784fe1eeede333`).

### DFX app

Repository: `DFXswiss/app`.

The SPAR payment page draws the street map when the merchant is SPAR. The pins
are SPAR places in Switzerland. The page requests
`GET /map/places?shopName=SPAR&country=CH` on `https://api.opencryptopay.io`.

The map is on `develop` (`5d2ac468d644098859f69e8876010d988c3417c3`) and on
`main` (`390b060291edbcdd603015d3c2c14321b925c4cf`).

## Outline map

### RealUnit app

Repository: `RealUnitCH/app`.

The pay-info screen links to `/payLocations`. That screen draws a white outline
of Switzerland, with lakes and pins. It does not use the street map. It reads
`GET /map/places?blockchain=Ethereum&asset=ZCHF` on
`https://api.opencryptopay.io`.

`pay_locations.dart` and `pay_locations_page.dart` are the same files on
`develop` (`dbc3fdf59116b74f0abd6b9cbb9ff1b95ebc15d9`) and on `staging`
(`413fe044814cafe375bd590e13d404919e1dc89a`). The screen is not on `main`
(`4eca16a9302902b59d0884c45012bc4279e803c1`).

## Google Maps

### 21.gifts

Repository: `21gifts/app`.

`/shops#map` draws member shops with Google Maps. It does not use the
OpenCryptoPay street map. A missing or unknown hash opens the post list.
`ShopsScreen.tsx` is the same file on `develop`
(`1f6adf9623af1c58fa2405693c29444bc47a5558`) and on `main`
(`90c84c65f974349c74715b5838784fe1eeede333`). `PlacesMapScreen.tsx` differs
between those branches. Both draw Google Maps.

## Not a drawn map

This repository, `openCryptoPay/api`, stores and serves the place list. It
does not draw a map. `DFXswiss/backend` reports a payment with
`POST /map/places/transactions`. That call does not draw a map.
