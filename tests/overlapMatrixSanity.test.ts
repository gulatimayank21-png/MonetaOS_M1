import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateUniverseMetrics } from '../src/utils/quantEngine';
import { INITIAL_NIFTY500_STOCKS, getStocksForIndex } from '../src/data/nifty500Data';
import { StockRecord, FilterSettings } from '../src/types';

describe('Multi-Timeframe Overlap Matrix Mathematical Sanity & Cohort Divergence', () => {
  const defaultFilters: FilterSettings = {
    mode: 'percentile',
    percentileThreshold: 25, // Top 25%
    topCountThreshold: 50,
    enforce52WHigh: true,
    maxDistance52WHighPct: 5,
    selectedSector: 'ALL',
    selectedCategory: 'ALL',
    searchQuery: '',
    showOnlyWinners: false,
    sortBy: 'composite',
    sortOrder: 'desc',
  };

  it('1. Explains why 1M, 3M, and 1Y each have 125 stocks in N500: N * 25% = 125', () => {
    const res = calculateUniverseMetrics(INITIAL_NIFTY500_STOCKS as StockRecord[], defaultFilters);
    const total = res.processedStocks.length;
    assert.strictEqual(total, 500, 'Universe must be 500 stocks');

    const cutoffRank = Math.ceil((defaultFilters.percentileThreshold / 100) * total);
    assert.strictEqual(cutoffRank, 125, 'Top 25% of 500 stocks is mathematically 125');

    const top1M = res.processedStocks.filter((s) => (s.rank1M || 999) <= cutoffRank);
    const top3M = res.processedStocks.filter((s) => (s.rank3M || 999) <= cutoffRank);
    const top1Y = res.processedStocks.filter((s) => (s.rank1Y || 999) <= cutoffRank);

    // Each individual category has 125 stocks because every stock gets ranked 1..500
    assert.strictEqual(top1M.length, 125, '1M top quartile has 125 stocks');
    assert.strictEqual(top3M.length, 125, '3M top quartile has 125 stocks');
    assert.strictEqual(top1Y.length, 125, '1Y top quartile has 125 stocks');
  });

  it('2. Mathematically proves 1M, 3M, and 1Y cohorts are NOT the same stocks (High Constituent Divergence)', () => {
    const res = calculateUniverseMetrics(INITIAL_NIFTY500_STOCKS as StockRecord[], defaultFilters);
    const cutoffRank = 125;

    const set1M = new Set(res.processedStocks.filter((s) => (s.rank1M || 999) <= cutoffRank).map((s) => s.ticker));
    const set3M = new Set(res.processedStocks.filter((s) => (s.rank3M || 999) <= cutoffRank).map((s) => s.ticker));
    const set1Y = new Set(res.processedStocks.filter((s) => (s.rank1Y || 999) <= cutoffRank).map((s) => s.ticker));

    // Stocks in 1M but NOT in 3M
    const uniqueTo1M = [...set1M].filter((t) => !set3M.has(t));
    assert.ok(
      uniqueTo1M.length >= 35,
      `Expected at least 35 stocks in 1M that are NOT in 3M, got ${uniqueTo1M.length}`
    );

    // Stocks in 1Y but NOT in 1M
    const uniqueTo1Y = [...set1Y].filter((t) => !set1M.has(t));
    assert.ok(
      uniqueTo1Y.length >= 40,
      `Expected at least 40 stocks in 1Y that are NOT in 1M, got ${uniqueTo1Y.length}`
    );

    // Jaccard similarity between 1M and 1Y (Intersection / Union)
    const intersection1M_1Y = [...set1M].filter((t) => set1Y.has(t)).length;
    const union1M_1Y = new Set([...set1M, ...set1Y]).size;
    const jaccardSimilarity = intersection1M_1Y / union1M_1Y;

    // A low Jaccard similarity (< 0.50) proves they are fundamentally distinct cohorts
    assert.ok(
      jaccardSimilarity < 0.50,
      `Jaccard similarity between 1M and 1Y must be < 0.50 (got ${(jaccardSimilarity * 100).toFixed(1)}%), proving they are distinct cohorts`
    );
  });

  it('3. Asserts Triple Timeframe Intersection (1M ∩ 3M ∩ 1Y) is only ~48 stocks (38.4% overlap rate)', () => {
    const res = calculateUniverseMetrics(INITIAL_NIFTY500_STOCKS as StockRecord[], defaultFilters);
    const cutoffRank = 125;

    const set1M = new Set(res.processedStocks.filter((s) => (s.rank1M || 999) <= cutoffRank).map((s) => s.ticker));
    const set3M = new Set(res.processedStocks.filter((s) => (s.rank3M || 999) <= cutoffRank).map((s) => s.ticker));
    const set1Y = new Set(res.processedStocks.filter((s) => (s.rank1Y || 999) <= cutoffRank).map((s) => s.ticker));

    const tripleOverlap = res.processedStocks.filter(
      (s) => set1M.has(s.ticker) && set3M.has(s.ticker) && set1Y.has(s.ticker)
    );

    assert.strictEqual(
      tripleOverlap.length,
      48,
      `Exactly 48 stocks qualify across all three timeframes simultaneously (got ${tripleOverlap.length})`
    );

    // Overlap rate vs individual bucket of 125
    const overlapRate = (tripleOverlap.length / 125) * 100;
    assert.ok(
      overlapRate < 45,
      `Overlap rate must be < 45% (got ${overlapRate.toFixed(1)}%), proving strong selectivity`
    );
  });

  it('4. Asserts 52-Week High Rule filters the 48 triple-overlap stocks down to 25 final Super-Trend winners', () => {
    const res = calculateUniverseMetrics(INITIAL_NIFTY500_STOCKS as StockRecord[], defaultFilters);

    assert.strictEqual(
      res.overlappingWinners.length,
      25,
      `Expected exactly 25 Super-Trend winners passing 52W High rule (got ${res.overlappingWinners.length})`
    );

    // Every single winner must satisfy 52W high rule
    res.overlappingWinners.forEach((winner) => {
      assert.ok(winner.isOverlappingWinner, `${winner.ticker} must have isOverlappingWinner true`);
      assert.ok(
        Math.abs(winner.pctFrom52WHigh || 0) <= defaultFilters.maxDistance52WHighPct,
        `${winner.ticker} must trade within 5% of 52W High`
      );
    });
  });

  it('5. Verifies Return Cutoff Thresholds differ substantially across 1M, 3M, and 1Y', () => {
    const sorted1M = [...INITIAL_NIFTY500_STOCKS].sort((a, b) => b.return1M - a.return1M);
    const sorted3M = [...INITIAL_NIFTY500_STOCKS].sort((a, b) => b.return3M - a.return3M);
    const sorted1Y = [...INITIAL_NIFTY500_STOCKS].sort((a, b) => b.return1Y - a.return1Y);

    const cutoffReturn1M = sorted1M[124].return1M;
    const cutoffReturn3M = sorted3M[124].return3M;
    const cutoffReturn1Y = sorted1Y[124].return1Y;

    // Minimum hurdle return to enter the Top 25%
    assert.ok(cutoffReturn1M < cutoffReturn3M, '1M cutoff return must be less than 3M cutoff return');
    assert.ok(cutoffReturn3M < cutoffReturn1Y, '3M cutoff return must be less than 1Y cutoff return');

    assert.strictEqual(cutoffReturn1M, 1.3, '125th stock in 1M has +1.3% return');
    assert.strictEqual(cutoffReturn3M, 9.1, '125th stock in 3M has +9.1% return');
    assert.strictEqual(cutoffReturn1Y, 19.8, '125th stock in 1Y has +19.8% return');
  });

  it('6. Dynamically scales cutoff when selecting different index universes (e.g. Nifty 50 = 13, Midcap 150 = 38)', () => {
    // Nifty 50 test
    const nifty50Stocks = getStocksForIndex(INITIAL_NIFTY500_STOCKS as StockRecord[], 'nifty50');
    assert.strictEqual(nifty50Stocks.length, 50);
    const res50 = calculateUniverseMetrics(nifty50Stocks, defaultFilters);
    const cutoff50 = Math.ceil(0.25 * 50); // 13
    assert.strictEqual(cutoff50, 13);
    const top1M_50 = res50.processedStocks.filter((s) => (s.rank1M || 999) <= cutoff50);
    assert.strictEqual(top1M_50.length, 13, 'Nifty 50 top 25% has 13 stocks');

    // Nifty Midcap 150 test
    const midcap150Stocks = getStocksForIndex(INITIAL_NIFTY500_STOCKS as StockRecord[], 'niftymidcap150');
    assert.strictEqual(midcap150Stocks.length, 150);
    const res150 = calculateUniverseMetrics(midcap150Stocks, defaultFilters);
    const cutoff150 = Math.ceil(0.25 * 150); // 38
    assert.strictEqual(cutoff150, 38);
    const top1M_150 = res150.processedStocks.filter((s) => (s.rank1M || 999) <= cutoff150);
    assert.strictEqual(top1M_150.length, 38, 'Nifty Midcap 150 top 25% has 38 stocks');
  });
});
