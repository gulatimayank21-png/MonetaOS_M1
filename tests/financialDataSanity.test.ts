import { describe, it } from 'node:test';
import assert from 'node:assert';
import { INITIAL_NIFTY500_STOCKS } from '../src/data/nifty500Data';

describe('Financial Data Integrity & Corporate Action Sanity', () => {
  it('1. Verifies no delisted or obsolete company names/tickers exist in universe', () => {
    // Check that defunct ticker ZOMATO does not exist
    const hasDefunctZomato = INITIAL_NIFTY500_STOCKS.some(
      (s) => s.ticker === 'ZOMATO' || s.symbol === 'ZOMATO.NS'
    );
    assert.strictEqual(
      hasDefunctZomato,
      false,
      'ZOMATO is delisted/rebranded and must NOT exist in universe'
    );

    // Check that active rebranded entity ETERNAL exists
    const eternal = INITIAL_NIFTY500_STOCKS.find((s) => s.ticker === 'ETERNAL');
    assert.ok(eternal, 'ETERNAL (Eternal Limited) must exist as the current listed entity for Zomato');
    assert.strictEqual(eternal?.symbol, 'ETERNAL.NS');
    assert.ok(eternal?.lastClose > 0 && eternal?.lastClose < 1000, `Eternal price should be valid (got ${eternal?.lastClose})`);

    // Check that obsolete pre-demerger TATAMOTORS does not exist
    const hasDefunctTataMotors = INITIAL_NIFTY500_STOCKS.some(
      (s) => s.ticker === 'TATAMOTORS' || s.symbol === 'TATAMOTORS.NS'
    );
    assert.strictEqual(
      hasDefunctTataMotors,
      false,
      'Pre-demerger TATAMOTORS ticker must be replaced by demerged entities (e.g. TMPV)'
    );

    const tmpv = INITIAL_NIFTY500_STOCKS.find((s) => s.ticker === 'TMPV');
    assert.ok(tmpv, 'TMPV (Tata Motors Passenger Vehicles) must exist');
    assert.strictEqual(tmpv?.symbol, 'TMPV.NS');
  });

  it('2. Enforces Trent corporate adjustment sanity', () => {
    const trent = INITIAL_NIFTY500_STOCKS.find((s) => s.ticker === 'TRENT');
    assert.ok(trent, 'Trent must exist in universe');
    // Trent had a post-split/corporate price adjustment from ~7,500 down to ~2,800
    assert.ok(
      trent?.lastClose > 2000 && trent?.lastClose < 3500,
      `Trent price must reflect corporate adjusted trading range ~2,800 (got ${trent?.lastClose})`
    );
    assert.ok(
      trent?.high52w >= trent?.lastClose,
      `Trent 52W high (${trent?.high52w}) must be >= lastClose (${trent?.lastClose})`
    );
  });

  it('3. Ensures zero duplicates in tickers or symbols', () => {
    const tickers = INITIAL_NIFTY500_STOCKS.map((s) => s.ticker);
    const uniqueTickers = new Set(tickers);
    assert.strictEqual(tickers.length, uniqueTickers.size, 'All tickers in universe must be strictly unique');

    const symbols = INITIAL_NIFTY500_STOCKS.map((s) => s.symbol);
    const uniqueSymbols = new Set(symbols);
    assert.strictEqual(symbols.length, uniqueSymbols.size, 'All symbols in universe must be strictly unique');
  });

  it('4. Enforces valid NSE exchange suffix on all symbols', () => {
    INITIAL_NIFTY500_STOCKS.forEach((stock) => {
      assert.ok(
        stock.symbol.endsWith('.NS'),
        `Stock ${stock.ticker} symbol (${stock.symbol}) must end with .NS for NSE India`
      );
    });
  });

  it('5. Enforces mathematical boundaries on price and 52-week extremes', () => {
    INITIAL_NIFTY500_STOCKS.forEach((stock) => {
      // Positive prices
      assert.ok(stock.lastClose > 0, `${stock.ticker}: lastClose must be positive (got ${stock.lastClose})`);
      assert.ok(stock.cmp > 0, `${stock.ticker}: cmp must be positive (got ${stock.cmp})`);
      assert.ok(stock.high52w > 0, `${stock.ticker}: high52w must be positive`);
      assert.ok(stock.low52w > 0, `${stock.ticker}: low52w must be positive`);

      // 52W High >= LastClose and 52W High >= 52W Low
      assert.ok(
        stock.high52w >= stock.lastClose,
        `${stock.ticker}: high52w (${stock.high52w}) cannot be lower than lastClose (${stock.lastClose})`
      );
      assert.ok(
        stock.high52w >= stock.low52w,
        `${stock.ticker}: high52w (${stock.high52w}) cannot be lower than low52w (${stock.low52w})`
      );

      // Returns must be finite numbers
      assert.strictEqual(Number.isFinite(stock.return1M), true, `${stock.ticker}: return1M must be finite`);
      assert.strictEqual(Number.isFinite(stock.return3M), true, `${stock.ticker}: return3M must be finite`);
      assert.strictEqual(Number.isFinite(stock.return1Y), true, `${stock.ticker}: return1Y must be finite`);
    });
  });
});
