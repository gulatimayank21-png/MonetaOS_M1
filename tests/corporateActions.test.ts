import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveCorporateAction, applyBrokerCorporateActions, KNOWN_CORPORATE_ACTIONS } from '../src/utils/corporateActions';

describe('Broker-Grade Corporate Action Adjustments (Zerodha / Angel One style)', () => {
  it('1. Resolves ZOMATO -> ETERNAL (Eternal Ltd.) with correct ISIN and ticker', () => {
    const res = resolveCorporateAction('ZOMATO');
    assert.strictEqual(res.wasAdjusted, true);
    assert.strictEqual(res.resolvedTicker, 'ETERNAL');
    assert.strictEqual(res.resolvedSymbol, 'ETERNAL.NS');
    assert.strictEqual(res.isin, 'INE758T01015');
    assert.strictEqual(res.companyName, 'Eternal Ltd.');
    assert.ok(res.brokerNote?.includes('Eternal'), 'Must include broker audit note');
  });

  it('2. Resolves TATAMOTORS -> TMPV (Tata Motors Passenger Vehicles)', () => {
    const res = resolveCorporateAction('TATAMOTORS.NS');
    assert.strictEqual(res.wasAdjusted, true);
    assert.strictEqual(res.resolvedTicker, 'TMPV');
    assert.strictEqual(res.resolvedSymbol, 'TMPV.NS');
    assert.strictEqual(res.isin, 'INE155A01022');
    assert.strictEqual(res.companyName, 'Tata Motors Passenger Vehicles Ltd.');
  });

  it('3. Resolves legacy mergers (LTI and MINDTREE -> LTIM)', () => {
    const ltiRes = resolveCorporateAction('LTI');
    assert.strictEqual(ltiRes.wasAdjusted, true);
    assert.strictEqual(ltiRes.resolvedTicker, 'LTIM');
    assert.strictEqual(ltiRes.isin, 'INE214T01019');

    const mindtreeRes = resolveCorporateAction('MINDTREE');
    assert.strictEqual(mindtreeRes.wasAdjusted, true);
    assert.strictEqual(mindtreeRes.resolvedTicker, 'LTIM');
    assert.strictEqual(mindtreeRes.isin, 'INE214T01019');
  });

  it('4. Resolves legacy renames (MOTHERSUMI -> MOTHERSON, CADILAHC -> ZYDUSLIFE)', () => {
    const mothersonRes = resolveCorporateAction('MOTHERSUMI');
    assert.strictEqual(mothersonRes.wasAdjusted, true);
    assert.strictEqual(mothersonRes.resolvedTicker, 'MOTHERSON');

    const zydusRes = resolveCorporateAction('CADILAHC');
    assert.strictEqual(zydusRes.wasAdjusted, true);
    assert.strictEqual(zydusRes.resolvedTicker, 'ZYDUSLIFE');
  });

  it('5. Passes through unmodified active tickers without mutation', () => {
    const reliance = resolveCorporateAction('RELIANCE');
    assert.strictEqual(reliance.wasAdjusted, false);
    assert.strictEqual(reliance.resolvedTicker, 'RELIANCE');
    assert.strictEqual(reliance.resolvedSymbol, 'RELIANCE.NS');
  });

  it('6. Successfully batches and cleanses raw broker feeds with applyBrokerCorporateActions', () => {
    const rawFeed = [
      { ticker: 'ZOMATO', name: 'Zomato Ltd.' },
      { ticker: 'TATAMOTORS', name: 'Tata Motors' },
      { ticker: 'TCS', name: 'Tata Consultancy Services' },
      { ticker: 'MOTHERSUMI', name: 'Motherson Sumi' },
    ];

    const { adjustedStocks, adjustmentCount } = applyBrokerCorporateActions(rawFeed);
    assert.strictEqual(adjustmentCount, 3, 'Should adjust 3 legacy tickers');
    assert.strictEqual(adjustedStocks[0].ticker, 'ETERNAL');
    assert.strictEqual(adjustedStocks[1].ticker, 'TMPV');
    assert.strictEqual(adjustedStocks[2].ticker, 'TCS');
    assert.strictEqual(adjustedStocks[3].ticker, 'MOTHERSON');
  });
});
