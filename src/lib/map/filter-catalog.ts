/**
 * Temporary payment-link filter catalog.
 * Networks are those offered for payment links, without test networks and
 * without Plasma. Assets are the payment-enabled names on those networks,
 * not the sellable names.
 * 21.gifts is Lightning and BTC only. Replace this module when the offer
 * is read from the payment service.
 */

const GIFTS_TECH_PROVIDER = '21.gifts';
const DFX_TECH_PROVIDER = 'DFX.swiss';
const GIFTS_BLOCKCHAIN = 'Lightning';
const GIFTS_ASSET = 'BTC';

/** Every activity a place can have, in filter order. Not limited to stored rows. */
export const PLACE_ACTIVITIES = [
  'daily',
  'within7Days',
  'within30Days',
  'olderThan30Days',
  'none',
] as const;

const DFX_BLOCKCHAINS: readonly string[] = [
  'Arbitrum',
  'Base',
  'BinancePay',
  'BinanceSmartChain',
  'Bitcoin',
  'Cardano',
  'Ethereum',
  'Firo',
  'Gnosis',
  'InternetComputer',
  'KucoinPay',
  'Lightning',
  'Monero',
  'Optimism',
  'Polygon',
  'Solana',
  'Spark',
  'Tron',
  'Zano',
];

const DFX_PAIRS: readonly { blockchain: string; asset: string }[] = [
  { blockchain: 'Arbitrum', asset: 'ETH' },
  { blockchain: 'Arbitrum', asset: 'USDC' },
  { blockchain: 'Arbitrum', asset: 'USDT' },
  { blockchain: 'Arbitrum', asset: 'WBTC' },
  { blockchain: 'Arbitrum', asset: 'dEURO' },
  { blockchain: 'Base', asset: 'ETH' },
  { blockchain: 'Base', asset: 'USDC' },
  { blockchain: 'Base', asset: 'dEURO' },
  { blockchain: 'BinancePay', asset: 'USDT' },
  { blockchain: 'BinanceSmartChain', asset: 'BNB' },
  { blockchain: 'BinanceSmartChain', asset: 'USDC' },
  { blockchain: 'BinanceSmartChain', asset: 'USDT' },
  { blockchain: 'Bitcoin', asset: 'BTC' },
  { blockchain: 'Cardano', asset: 'ADA' },
  { blockchain: 'Ethereum', asset: 'ETH' },
  { blockchain: 'Ethereum', asset: 'USDC' },
  { blockchain: 'Ethereum', asset: 'USDT' },
  { blockchain: 'Ethereum', asset: 'WBTC' },
  { blockchain: 'Ethereum', asset: 'ZCHF' },
  { blockchain: 'Ethereum', asset: 'dEURO' },
  { blockchain: 'Firo', asset: 'FIRO' },
  { blockchain: 'InternetComputer', asset: 'ICP' },
  { blockchain: 'InternetComputer', asset: 'VCHF' },
  { blockchain: 'InternetComputer', asset: 'VEUR' },
  { blockchain: 'InternetComputer', asset: 'ckBTC' },
  { blockchain: 'KucoinPay', asset: 'USDT' },
  { blockchain: 'Lightning', asset: 'BTC' },
  { blockchain: 'Monero', asset: 'XMR' },
  { blockchain: 'Optimism', asset: 'ETH' },
  { blockchain: 'Optimism', asset: 'USDC' },
  { blockchain: 'Optimism', asset: 'USDT' },
  { blockchain: 'Optimism', asset: 'WBTC' },
  { blockchain: 'Optimism', asset: 'dEURO' },
  { blockchain: 'Polygon', asset: 'POL' },
  { blockchain: 'Polygon', asset: 'USDC' },
  { blockchain: 'Polygon', asset: 'USDT' },
  { blockchain: 'Polygon', asset: 'WBTC' },
  { blockchain: 'Polygon', asset: 'ZCHF' },
  { blockchain: 'Polygon', asset: 'dEURO' },
  { blockchain: 'Solana', asset: 'SOL' },
  { blockchain: 'Solana', asset: 'USDC' },
  { blockchain: 'Solana', asset: 'USDT' },
  { blockchain: 'Spark', asset: 'BTC' },
  { blockchain: 'Tron', asset: 'TRX' },
  { blockchain: 'Tron', asset: 'USDT' },
];

const CHAIN_SET: ReadonlySet<string> = new Set(DFX_BLOCKCHAINS);
const ASSET_SET: ReadonlySet<string> = new Set(DFX_PAIRS.map((pair) => pair.asset));
const PAIR_KEYS: ReadonlySet<string> = new Set(
  DFX_PAIRS.map((pair) => `${pair.blockchain}\0${pair.asset}`),
);

export type MapFilterTechProvider = {
  name: string;
  blockchains: string[];
  assets: string[];
  pairs: { blockchain: string; asset: string }[];
};

export type PublicMapFilters = {
  shopTypes: ['SPAR', 'Others'];
  /** Deprecated, one release: removed in the release after the rollout. */
  shopNames: ['SPAR', 'others'];
  countries: string[];
  blockchains: string[];
  assets: string[];
  activities: typeof PLACE_ACTIVITIES;
  techProviders: MapFilterTechProvider[];
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function offerFlags(
  blockchain: string | undefined,
  asset: string | undefined,
): { gifts: boolean; dfx: boolean } {
  const gifts =
    (blockchain === undefined || blockchain === GIFTS_BLOCKCHAIN) &&
    (asset === undefined || asset === GIFTS_ASSET) &&
    (blockchain !== undefined || asset !== undefined);
  let dfx = false;
  if (blockchain !== undefined && asset !== undefined) {
    dfx = PAIR_KEYS.has(`${blockchain}\0${asset}`);
  } else if (blockchain !== undefined) {
    dfx = CHAIN_SET.has(blockchain);
  } else if (asset !== undefined) {
    dfx = ASSET_SET.has(asset);
  }
  return { gifts, dfx };
}

function assetsFor(blockchain: string | undefined): string[] {
  if (blockchain === undefined) {
    return [...ASSET_SET];
  }
  const values: string[] = [];
  for (const pair of DFX_PAIRS) {
    if (pair.blockchain === blockchain) {
      values.push(pair.asset);
    }
  }
  return values;
}

/**
 * Whether a query network is in the hardcoded payment-link catalog.
 *
 * @param value - Trimmed blockchain query.
 * @returns True for a catalog network, including BinancePay and KucoinPay.
 */
export function isCatalogBlockchain(value: string): boolean {
  return CHAIN_SET.has(value);
}

/**
 * Whether a query asset is in the hardcoded payment-link catalog.
 *
 * @param value - Trimmed asset query.
 * @returns True for a catalog asset, including ckBTC and dEURO.
 */
export function isCatalogAsset(value: string): boolean {
  return ASSET_SET.has(value);
}

/**
 * Whether a tech provider's offer includes a payment filter.
 *
 * @param techProvider - Stored tech provider. Origin is not an input.
 * @param blockchain - Requested network, if any.
 * @param asset - Requested asset, if any.
 * @returns True when that provider's offer includes the request. An omitted
 *   filter matches. A provider other than DFX.swiss or 21.gifts matches none.
 */
export function matchesUnstatedPayment(
  techProvider: string,
  blockchain: string | undefined,
  asset: string | undefined,
): boolean {
  if (blockchain === undefined && asset === undefined) {
    return true;
  }
  const offer = offerFlags(blockchain, asset);
  if (techProvider === GIFTS_TECH_PROVIDER) {
    return offer.gifts;
  }
  if (techProvider === DFX_TECH_PROVIDER) {
    return offer.dfx;
  }
  return false;
}

/**
 * SQL for a blockchain or asset filter. The predicate is the tech provider only.
 *
 * @param blockchain - Requested network, if any.
 * @param asset - Requested asset, if any.
 * @returns A parenthesised predicate and its bound parameters, or null when
 *   the query sets neither network nor asset.
 */
export function unstatedPaymentSql(
  blockchain?: string | undefined,
  asset?: string | undefined,
): { sql: string; params: string[] } | null {
  if (blockchain === undefined && asset === undefined) {
    return null;
  }
  const giftsFlag = matchesUnstatedPayment(GIFTS_TECH_PROVIDER, blockchain, asset) ? '1' : '0';
  const dfxFlag = matchesUnstatedPayment(DFX_TECH_PROVIDER, blockchain, asset) ? '1' : '0';
  return {
    sql: `((tech_provider = '21.gifts' AND ? = '1') OR (tech_provider = 'DFX.swiss' AND ? = '1'))`,
    params: [giftsFlag, dfxFlag],
  };
}

/**
 * Public filter payload: stored values plus the hardcoded payment-link offer.
 *
 * @param stored - Distinct countries, blockchains, and assets already stored.
 * @param blockchain - When set, top-level assets are limited to that network.
 * @returns Shop-type tokens, the deprecated shop-name alias, countries, networks, assets, every activity value, and per-provider offers.
 */
export function publicFilterResponse(
  stored: { countries: string[]; blockchains: string[]; assets: string[] },
  blockchain?: string | undefined,
): PublicMapFilters {
  return {
    shopTypes: ['SPAR', 'Others'],
    shopNames: ['SPAR', 'others'],
    countries: stored.countries,
    blockchains: uniqueSorted([...DFX_BLOCKCHAINS, ...stored.blockchains]),
    assets: uniqueSorted([...assetsFor(blockchain), ...stored.assets]),
    activities: PLACE_ACTIVITIES,
    techProviders: [
      {
        name: 'DFX.swiss',
        blockchains: [...DFX_BLOCKCHAINS],
        assets: [...ASSET_SET].sort(),
        pairs: DFX_PAIRS.map((pair) => ({ blockchain: pair.blockchain, asset: pair.asset })),
      },
      {
        name: GIFTS_TECH_PROVIDER,
        blockchains: [GIFTS_BLOCKCHAIN],
        assets: [GIFTS_ASSET],
        pairs: [{ blockchain: GIFTS_BLOCKCHAIN, asset: GIFTS_ASSET }],
      },
    ],
  };
}

/**
 * Public support pairs for one pin. The tech provider is the whole rule.
 *
 * DFX.swiss is the DFX catalog, including ZCHF on Ethereum and Polygon.
 * 21.gifts is Lightning and BTC. Any other provider is an empty list.
 * Origin and stored support rows are not inputs.
 *
 * @param techProvider - Stored tech provider.
 * @returns A new array of pairs.
 */
export function publicPlaceSupports(techProvider: string): { blockchain: string; asset: string }[] {
  if (techProvider === GIFTS_TECH_PROVIDER) {
    return [{ blockchain: GIFTS_BLOCKCHAIN, asset: GIFTS_ASSET }];
  }
  if (techProvider === DFX_TECH_PROVIDER) {
    return DFX_PAIRS.map((pair) => ({ blockchain: pair.blockchain, asset: pair.asset }));
  }
  return [];
}
