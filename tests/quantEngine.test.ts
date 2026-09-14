import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateUniverseMetrics,
  buildEqualWeightPortfolio,
} from '../src/utils/quantEngine';
import { StockRecord, FilterSettings } from '../src/types';

const defaultFilters: FilterSettings = {
  mode: 'percentile',
  percentileThreshold: 50, // Top 50% for 4 stocks = top 2
  topCountThreshold: 2,
  enforce52WHigh: true,
  maxDistance52WHighPct: 5,
  selectedSector: 'All',
  selectedCategory: 'All',
  searchQuery: '',
  showOnlyWinners: false,
  sortBy: 'composite',
  sortOrder: 'desc',
};

describe('Quant Momentum Engine - Theoretical & Mathematical Rules', () => {
  const sampleStocks: Omit<StockRecord, 'rank1M' | 'rank3M' | 'rank1Y' | 'percentile1M' | 'percentile3M' | 'percentile1Y' | 'compositeMomentumScore' | 'pctFrom52WHigh' | 'isWithin52WHigh' | 'isOverlappingWinner'>[] = [
    {
      id: 'stock-a',
      symbol: 'STOCKA.NS',
      ticker: 'STOCKA',
      name: 'Stock Alpha',
      sector: 'Technology',
      category: 'Large Cap',
      lastClose: 1000,
      cmp: 1010,
      cmpChangePct: 1.0,
      high52w: 1020, // 1.96% from 52W high (within 5%)
      low52w: 500,
      return1M: 25.0, // Rank 2 in 1M
      return3M: 40.0, // Top in 3M
      return1Y: 100.0, // Top in 1Y
    },
    {
      id: 'stock-b',
      symbol: 'STOCKB.NS',
      ticker: 'STOCKB',
      name: 'Stock Beta',
      sector: 'Technology',
      category: 'Mid Cap',
      lastClose: 500,
      cmp: 505,
      cmpChangePct: 1.0,
      high52w: 510, // ~2% from 52W high
      low52w: 300,
      return1M: 20.0, // Rank 3 in 1M
      return3M: 35.0, // Rank 2 in 3M
      return1Y: 80.0, // Rank 2 in 1Y
    },
    {
      id: 'stock-c',
      symbol: 'STOCKC.NS',
      ticker: 'STOCKC',
      name: 'Stock Gamma (False Breakout)',
      sector: 'Consumer',
      category: 'Small Cap',
      lastClose: 200,
      cmp: 202,
      cmpChangePct: 1.0,
      high52w: 205,
      low52w: 150,
      return1M: 30.0, // Top in 1M
      return3M: -10.0, // Poor in 3M
      return1Y: -20.0, // Poor in 1Y
    },
    {
      id: 'stock-d',
      symbol: 'STOCKD.NS',
      ticker: 'STOCKD',
      name: 'Stock Delta (Tired Momentum)',
      sector: 'Energy',
      category: 'Large Cap',
      lastClose: 300,
      cmp: 298,
      cmpChangePct: -0.6,
      high52w: 450, // -33% from 52W high (violates 52W rule)
      low52w: 180,
      return1M: 15.0,
      return3M: 30.0,
      return1Y: 70.0,
    },
  ];

  it('1. Calculates ranking vectors correctly anchored to lastClose', () => {
    const { processedStocks } = calculateUniverseMetrics(sampleStocks as StockRecord[], defaultFilters);
    assert.strictEqual(processedStocks.length, 4);

    const stockA = processedStocks.find((s) => s.ticker === 'STOCKA');
    assert.ok(stockA);
    assert.strictEqual(stockA?.rank1M, 2); // Stock C had 30% in 1M, Stock A has 25%
    assert.strictEqual(stockA?.rank3M, 1);
    assert.strictEqual(stockA?.rank1Y, 1);

    // Percentile scores must be between 0 and 100
    assert.ok((stockA?.percentile1M ?? 0) >= 0 && (stockA?.percentile1M ?? 0) <= 100);
    assert.ok((stockA?.percentile3M ?? 0) >= 0 && (stockA?.percentile3M ?? 0) <= 100);
    assert.ok((stockA?.percentile1Y ?? 0) >= 0 && (stockA?.percentile1Y ?? 0) <= 100);
  });

  it('2. Enforces 52-Week High Proximity: pctFrom52WHigh must be non-positive', () => {
    const { processedStocks } = calculateUniverseMetrics(sampleStocks as StockRecord[], defaultFilters);
    processedStocks.forEach((stock) => {
      assert.ok(
        (stock.pctFrom52WHigh ?? 0) <= 0.001,
        `Stock ${stock.ticker} pctFrom52WHigh (${stock.pctFrom52WHigh}%) should not exceed 0%`
      );
      assert.ok(stock.high52w >= stock.lastClose, `52W high (${stock.high52w}) must be >= lastClose (${stock.lastClose})`);
    });

    const stockD = processedStocks.find((s) => s.ticker === 'STOCKD');
    assert.ok(stockD);
    assert.strictEqual(stockD?.isWithin52WHigh, false, 'Stock D is 33% below 52W high, must fail 5% rule');
  });

  it('3. Multi-Timeframe Overlap Filter: Rejects single-horizon false breakouts', () => {
    const { overlappingWinners } = calculateUniverseMetrics(sampleStocks as StockRecord[], defaultFilters);

    // Stock C (Gamma) was high in 1M only, but negative in 3M and 1Y -> Must NOT be a winner
    const stockC = overlappingWinners.find((s) => s.ticker === 'STOCKC');
    assert.strictEqual(stockC, undefined, 'Stock C has false breakout (short-term only) and must be filtered out');

    // Stock D (Delta) failed 52W high rule -> Must NOT be a winner when rule is enforced
    const stockD = overlappingWinners.find((s) => s.ticker === 'STOCKD');
    assert.strictEqual(stockD, undefined, 'Stock D violates 52W high rule and must be filtered out');

    // Stock A satisfies all criteria (rank 2 in 1M <= 2, rank 1 in 3M <= 2, rank 1 in 1Y <= 2, within 52W high)
    const stockA = overlappingWinners.find((s) => s.ticker === 'STOCKA');
    assert.ok(stockA, 'Stock A satisfies all multi-timeframe overlap and 52W high criteria');
  });

  it('4. Equal-Weight Portfolio Allocator: Checks mathematical bounds and risk stops', () => {
    const { overlappingWinners } = calculateUniverseMetrics(sampleStocks as StockRecord[], defaultFilters);

    const capital = 1000000; // 10 Lakhs
    const config = {
      totalCapital: capital,
      topNStocks: 2,
      stopLossPct: 8.0,
      targetGainPct: 25.0,
    };

    const portfolio = buildEqualWeightPortfolio(overlappingWinners, config);
    assert.ok(portfolio.positions.length <= config.topNStocks);
    assert.ok(portfolio.totalInvested <= capital, 'Invested amount cannot exceed capital');
    assert.ok(portfolio.remainingCash >= 0, 'Remaining cash cannot be negative');

    portfolio.positions.forEach((pos) => {
      // Must be whole integer shares
      assert.strictEqual(Number.isInteger(pos.shares), true, 'Shares must be an integer');
      assert.ok(pos.shares > 0, 'Position must buy at least 1 share');
      // Stop loss price must be 92% of base price
      const base = pos.stock.lastClose || pos.stock.cmp;
      const expectedStop = Number((base * 0.92).toFixed(1));
      assert.strictEqual(pos.stopLossPrice, expectedStop, 'Stop loss must be exactly 8% below base');
      // Target price must be 125% of base price
      const expectedTarget = Number((base * 1.25).toFixed(1));
      assert.strictEqual(pos.targetPrice, expectedTarget, 'Target gain must be exactly 25% above base');
    });
  });

  it('5. Sector Tailwind Aggregation: Accurately identifies sector momentum leaders', () => {
    const { sectorTailwinds } = calculateUniverseMetrics(sampleStocks as StockRecord[], defaultFilters);
    assert.ok(sectorTailwinds.length > 0);

    const tech = sectorTailwinds.find((t) => t.sector === 'Technology');
    assert.ok(tech);
    assert.strictEqual(tech?.totalInSector, 2);
  });
});
