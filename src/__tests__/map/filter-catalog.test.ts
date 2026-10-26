import { describe, expect, it } from 'vitest';
import {
  isCatalogAsset,
  isCatalogBlockchain,
  matchesUnstatedPayment,
  PLACE_ACTIVITIES,
  publicFilterResponse,
  publicPlaceSupports,
  unstatedPaymentSql,
} from '@/lib/map/filter-catalog';
import type { PlaceActivity } from '@/lib/map/place';

type SameActivityList<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const activityListMatchesPlace: SameActivityList<PlaceActivity, (typeof PLACE_ACTIVITIES)[number]> =
  true;

describe('payment-link filter catalog', () => {
  it('names the payment-link networks and assets, not test or inactive ones', () => {
    expect(isCatalogBlockchain('Ethereum')).toBe(true);
    expect(isCatalogBlockchain('BinancePay')).toBe(true);
    expect(isCatalogBlockchain('KucoinPay')).toBe(true);
    expect(isCatalogBlockchain('Zano')).toBe(true);
    expect(isCatalogBlockchain('Lightning')).toBe(true);
    expect(isCatalogBlockchain('Plasma')).toBe(false);
    expect(isCatalogBlockchain('Sepolia')).toBe(false);
    expect(isCatalogBlockchain('Arkade')).toBe(false);
    expect(isCatalogBlockchain('Kraken')).toBe(false);

    expect(isCatalogAsset('ZCHF')).toBe(true);
    expect(isCatalogAsset('ckBTC')).toBe(true);
    expect(isCatalogAsset('dEURO')).toBe(true);
    expect(isCatalogAsset('USDC.e')).toBe(false);
    expect(isCatalogAsset('USDbC')).toBe(false);
    expect(isCatalogAsset('AAVE')).toBe(false);
    expect(isCatalogAsset('XPL')).toBe(false);
    expect(isCatalogAsset('ckbtc')).toBe(false);
  });

  it('matches a payment filter from the tech provider alone', () => {
    expect(matchesUnstatedPayment('DFX.swiss', undefined, undefined)).toBe(true);
    expect(matchesUnstatedPayment('DFX.swiss', 'Ethereum', undefined)).toBe(true);
    expect(matchesUnstatedPayment('DFX.swiss', 'Ethereum', 'ZCHF')).toBe(true);
    expect(matchesUnstatedPayment('DFX.swiss', 'Ethereum', 'BTC')).toBe(false);
    expect(matchesUnstatedPayment('DFX.swiss', 'Polygon', 'ZCHF')).toBe(true);
    expect(matchesUnstatedPayment('DFX.swiss', 'Arbitrum', 'AAVE')).toBe(false);
    expect(matchesUnstatedPayment('DFX.swiss', 'Gnosis', 'xDAI')).toBe(false);
    expect(matchesUnstatedPayment('DFX.swiss', 'Plasma', undefined)).toBe(false);
    expect(matchesUnstatedPayment('DFX.swiss', 'BinancePay', undefined)).toBe(true);
    expect(matchesUnstatedPayment('DFX.swiss', undefined, 'ckBTC')).toBe(true);
    expect(matchesUnstatedPayment('DFX.swiss', undefined, 'AAAA')).toBe(false);
    expect(matchesUnstatedPayment('DFX.swiss', 'Lightning', 'BTC')).toBe(true);

    expect(matchesUnstatedPayment('21.gifts', 'Ethereum', undefined)).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Lightning', undefined)).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Bitcoin', undefined)).toBe(false);
    expect(matchesUnstatedPayment('21.gifts', undefined, 'BTC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', undefined, 'USDT')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', undefined, 'USDC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Lightning', 'BTC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Spark', 'BTC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Ethereum', 'USDT')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Ethereum', 'USDC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Plasma', 'USDT')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Plasma', 'USDC')).toBe(false);
    expect(matchesUnstatedPayment('21.gifts', 'Arc', 'USDC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Tempo', 'USDC')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Tron', 'USDT')).toBe(true);
    expect(matchesUnstatedPayment('21.gifts', 'Lightning', 'ZCHF')).toBe(false);
    expect(matchesUnstatedPayment('21.gifts', 'Ethereum', 'ZCHF')).toBe(false);
    expect(matchesUnstatedPayment('21.gifts', undefined, 'ZCHF')).toBe(false);
    expect(matchesUnstatedPayment('21.gifts', undefined, 'ckBTC')).toBe(false);
    expect(matchesUnstatedPayment('Other', 'Ethereum', 'ZCHF')).toBe(false);
    expect(matchesUnstatedPayment('Other', 'Lightning', 'BTC')).toBe(false);
  });

  it('builds a tech-provider predicate and never a stored-row predicate', () => {
    expect(unstatedPaymentSql()).toBeNull();

    const none = unstatedPaymentSql('Arkade');
    expect(none?.params).toEqual(['0', '0']);
    expect(none?.sql).not.toContain('map_place_support');
    expect(none?.sql).not.toContain('origin');
    expect(unstatedPaymentSql('Ethereum', 'BTC')?.params).toEqual(['0', '0']);
    expect(unstatedPaymentSql(undefined, 'AAAA')?.params).toEqual(['0', '0']);
    expect(unstatedPaymentSql('Plasma')?.params).toEqual(['1', '0']);
    expect(unstatedPaymentSql('Plasma', 'USDT')?.params).toEqual(['1', '0']);
    expect(unstatedPaymentSql('Arc', 'USDC')?.params).toEqual(['1', '0']);

    const chain = unstatedPaymentSql('Ethereum');
    expect(chain?.params).toEqual(['1', '1']);
    expect(chain?.sql).toContain("tech_provider = '21.gifts'");
    expect(chain?.sql).toContain("tech_provider = 'DFX.swiss'");

    expect(unstatedPaymentSql('Lightning', 'BTC')?.params).toEqual(['1', '1']);
    expect(unstatedPaymentSql(undefined, 'ckBTC')?.params).toEqual(['0', '1']);
    expect(unstatedPaymentSql(undefined, 'BTC')?.params).toEqual(['1', '1']);
    expect(unstatedPaymentSql('BinancePay')?.params).toEqual(['0', '1']);
    expect(unstatedPaymentSql('Ethereum', 'ZCHF')?.params).toEqual(['0', '1']);
    expect(unstatedPaymentSql('Ethereum', 'USDT')?.params).toEqual(['1', '1']);
    expect(unstatedPaymentSql('Spark', 'BTC')?.params).toEqual(['1', '1']);
    expect(unstatedPaymentSql('Bitcoin')?.params).toEqual(['0', '1']);
  });

  it('unions stored filter values with the catalog and keeps provider offers whole', () => {
    const merged = publicFilterResponse({
      countries: ['CH'],
      blockchains: ['Plasma'],
      assets: ['ONDO', 'ZCHF'],
    });
    expect(merged.shopTypes).toEqual(['SPAR', 'Others']);
    expect(merged.shopNames).toEqual(['SPAR', 'others']);
    expect(activityListMatchesPlace).toBe(true);
    expect(merged.activities).toEqual([
      'daily',
      'within7Days',
      'within30Days',
      'olderThan30Days',
      'none',
    ]);
    expect(merged.countries).toEqual(['CH']);
    expect(merged.blockchains).toContain('Plasma');
    expect(merged.blockchains).toContain('Lightning');
    expect(merged.blockchains).not.toContain('Sepolia');
    expect(merged.blockchains[0]).toBe('Arbitrum');
    expect(merged.assets.filter((asset) => asset === 'ZCHF')).toHaveLength(1);
    expect(merged.assets).toContain('ONDO');
    expect(merged.assets).toContain('BTC');
    expect(merged.assets).toContain('ckBTC');

    const ethereum = publicFilterResponse(
      { countries: [], blockchains: ['Plasma', 'Ethereum'], assets: ['AAAA'] },
      'Ethereum',
    );
    expect(ethereum.assets).toContain('AAAA');
    expect(ethereum.assets).toContain('ZCHF');
    expect(ethereum.assets).not.toContain('ONDO');
    expect(ethereum.assets).not.toContain('BTC');
    expect(ethereum.blockchains).toContain('Plasma');
    expect(ethereum.activities).toBe(merged.activities);

    const plasma = publicFilterResponse(
      { countries: [], blockchains: ['Plasma'], assets: ['ONDO'] },
      'Plasma',
    );
    expect(plasma.assets).toEqual(['ONDO']);

    const dfx = merged.techProviders.find((provider) => provider.name === 'DFX.swiss');
    const gifts = merged.techProviders.find((provider) => provider.name === '21.gifts');
    expect(dfx?.blockchains).not.toContain('Plasma');
    expect(dfx?.blockchains).not.toContain('Sepolia');
    expect(dfx?.blockchains).toContain('BinancePay');
    expect(dfx?.blockchains).toContain('Zano');
    expect(dfx?.assets).not.toContain('XPL');
    expect(dfx?.pairs).toContainEqual({ blockchain: 'Ethereum', asset: 'ZCHF' });
    expect(dfx?.pairs).toContainEqual({ blockchain: 'Polygon', asset: 'ZCHF' });
    expect(dfx?.pairs).not.toContainEqual({ blockchain: 'Ethereum', asset: 'BTC' });
    expect(dfx?.pairs).not.toContainEqual({ blockchain: 'Arbitrum', asset: 'AAVE' });
    expect(dfx?.pairs).not.toContainEqual({ blockchain: 'Gnosis', asset: 'xDAI' });
    expect(dfx?.pairs).not.toContainEqual({ blockchain: 'Arkade', asset: 'BTC' });
    expect(gifts?.pairs).toEqual(publicPlaceSupports('21.gifts'));
    expect(gifts?.assets).toEqual(['BTC', 'USDC', 'USDT']);
    expect(gifts?.blockchains).toContain('Lightning');
    expect(gifts?.blockchains).toContain('Spark');
    expect(gifts?.blockchains).toContain('Plasma');
    expect(gifts?.blockchains).not.toContain('Bitcoin');
    expect(gifts?.pairs).toContainEqual({ blockchain: 'Lightning', asset: 'BTC' });
    expect(gifts?.pairs).toContainEqual({ blockchain: 'Spark', asset: 'BTC' });
    expect(gifts?.pairs).toContainEqual({ blockchain: 'Ethereum', asset: 'USDT' });
    expect(gifts?.pairs).toContainEqual({ blockchain: 'Ethereum', asset: 'USDC' });
    expect(gifts?.pairs).toContainEqual({ blockchain: 'Plasma', asset: 'USDT' });
    expect(gifts?.pairs).not.toContainEqual({ blockchain: 'Bitcoin', asset: 'BTC' });
    expect(gifts?.pairs).not.toContainEqual({ blockchain: 'Ethereum', asset: 'ZCHF' });
    expect(gifts?.pairs).not.toContainEqual({ blockchain: 'Plasma', asset: 'USDC' });
  });

  it('emits the DFX catalog for DFX.swiss, including ZCHF', () => {
    const supports = publicPlaceSupports('DFX.swiss');
    const dfx = publicFilterResponse({
      countries: [],
      blockchains: [],
      assets: [],
    }).techProviders.find((provider) => provider.name === 'DFX.swiss');
    if (dfx === undefined) {
      throw new Error('DFX.swiss catalog missing');
    }
    expect(supports).toContainEqual({ blockchain: 'Ethereum', asset: 'ZCHF' });
    expect(supports).toContainEqual({ blockchain: 'Polygon', asset: 'ZCHF' });
    expect(supports).toEqual(dfx.pairs);
  });

  it('emits Lightning, Spark, and the Flashnet USDT and USDC pairs for 21.gifts', () => {
    const supports = publicPlaceSupports('21.gifts');
    expect(supports).toContainEqual({ blockchain: 'Lightning', asset: 'BTC' });
    expect(supports).toContainEqual({ blockchain: 'Spark', asset: 'BTC' });
    expect(supports).toContainEqual({ blockchain: 'Ethereum', asset: 'USDT' });
    expect(supports).toContainEqual({ blockchain: 'Base', asset: 'USDC' });
    expect(supports).toContainEqual({ blockchain: 'Tron', asset: 'USDT' });
    expect(supports).not.toContainEqual({ blockchain: 'Bitcoin', asset: 'BTC' });
    expect(supports).not.toContainEqual({ blockchain: 'Ethereum', asset: 'ETH' });
    expect(supports.filter((pair) => pair.asset === 'USDT' || pair.asset === 'USDC')).toHaveLength(
      supports.length - 2,
    );
    const returned = publicPlaceSupports('21.gifts');
    returned.pop();
    expect(publicPlaceSupports('21.gifts')).toHaveLength(returned.length + 1);
  });

  it('emits nothing for a tech provider outside the two offers', () => {
    expect(publicPlaceSupports('Other')).toEqual([]);
    const returned = publicPlaceSupports('DFX.swiss');
    returned.pop();
    expect(publicPlaceSupports('DFX.swiss').length).toBeGreaterThan(0);
  });
});
