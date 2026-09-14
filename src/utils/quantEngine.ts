import { StockRecord, FilterSettings, SectorTailwindInfo, PortfolioAllocation, AllocatedPosition } from '../types';

/**
 * Calculates quant momentum metrics across 1M, 3M, and 1Y horizons for the universe
 */
export function calculateUniverseMetrics(
  rawStocks: StockRecord[],
  filters: FilterSettings
): {
  processedStocks: StockRecord[];
  overlappingWinners: StockRecord[];
  sectorTailwinds: SectorTailwindInfo[];
  stats: {
    totalUniverse: number;
    winnerCount: number;
    within52WHighCount: number;
    within52WCount?: number;
    dominantSector: string;
    avgWinner1MReturn: number;
    avgWinner3MReturn: number;
    avgWinner1YReturn: number;
  };
} {
  const n = rawStocks.length;
  if (n === 0) {
    return {
      processedStocks: [],
      overlappingWinners: [],
      sectorTailwinds: [],
      stats: {
        totalUniverse: 0,
        winnerCount: 0,
        within52WHighCount: 0,
        within52WCount: 0,
        dominantSector: 'N/A',
        avgWinner1MReturn: 0,
        avgWinner3MReturn: 0,
        avgWinner1YReturn: 0,
      },
    };
  }

  // 1. Sort copies to determine ranks (1 = highest return)
  const sorted1M = [...rawStocks].sort((a, b) => b.return1M - a.return1M);
  const sorted3M = [...rawStocks].sort((a, b) => b.return3M - a.return3M);
  const sorted1Y = [...rawStocks].sort((a, b) => b.return1Y - a.return1Y);

  const rank1MMap = new Map<string, number>();
  const rank3MMap = new Map<string, number>();
  const rank1YMap = new Map<string, number>();

  sorted1M.forEach((s, idx) => rank1MMap.set(s.id, idx + 1));
  sorted3M.forEach((s, idx) => rank3MMap.set(s.id, idx + 1));
  sorted1Y.forEach((s, idx) => rank1YMap.set(s.id, idx + 1));

  // Determine qualification cutoff threshold
  const cutoffRank =
    filters.mode === 'percentile'
      ? Math.max(1, Math.ceil((filters.percentileThreshold / 100) * n))
      : Math.min(n, filters.topCountThreshold);

  // 2. Process all stocks
  const processedStocks: StockRecord[] = rawStocks.map((stock) => {
    const r1 = rank1MMap.get(stock.id) || n;
    const r3 = rank3MMap.get(stock.id) || n;
    const rY = rank1YMap.get(stock.id) || n;

    // Percentiles (100% is best)
    const p1 = Number((((n - r1 + 1) / n) * 100).toFixed(1));
    const p3 = Number((((n - r3 + 1) / n) * 100).toFixed(1));
    const pY = Number((((n - rY + 1) / n) * 100).toFixed(1));

    // Quant Calculation Anchor: Always use Last Completed Trading Session's Close (lastClose)
    const basePrice = stock.lastClose || stock.cmp;

    // Distance from 52W High in % anchored to Last Completed Trading Session Close
    const pctFrom52WHigh =
      stock.high52w > 0
        ? Number((((basePrice - stock.high52w) / stock.high52w) * 100).toFixed(2))
        : 0;

    // Intraday % change of CMP (15-min delayed) vs Last Completed Trading Session Close
    const cmpChangePct =
      basePrice > 0
        ? Number((((stock.cmp - basePrice) / basePrice) * 100).toFixed(2))
        : 0;

    const isWithin52W = Math.abs(pctFrom52WHigh) <= filters.maxDistance52WHighPct;

    // Super-Trend Filter: Top 25% (or cutoffRank) on 1M, 3M, and 1Y
    const inTop1M = r1 <= cutoffRank;
    const inTop3M = r3 <= cutoffRank;
    const inTop1Y = rY <= cutoffRank;

    let isOverlapping = inTop1M && inTop3M && inTop1Y;
    if (filters.enforce52WHigh && !isWithin52W) {
      isOverlapping = false;
    }

    // Composite momentum score (0 to 100)
    const compositeScore = Number((0.3 * p1 + 0.35 * p3 + 0.35 * pY).toFixed(1));

    // Determine rebalance status simulation:
    // If previous returns were top tier but currently slipped out of 1M or 3M -> 'slipped_exit'
    let rebalanceStatus: StockRecord['rebalanceStatus'] = 'neutral';
    if (stock.previousReturn1M !== undefined && stock.previousReturn3M !== undefined) {
      const prevWasStrong = stock.previousReturn1M > 8 && stock.previousReturn3M > 20;
      if (prevWasStrong && (!inTop1M || !inTop3M)) {
        rebalanceStatus = 'slipped_exit';
      } else if (isOverlapping && !prevWasStrong) {
        rebalanceStatus = 'new_entrant';
      } else if (isOverlapping && prevWasStrong) {
        rebalanceStatus = 'retained';
      }
    } else {
      rebalanceStatus = isOverlapping ? 'retained' : 'neutral';
    }

    return {
      ...stock,
      rank1M: r1,
      rank3M: r3,
      rank1Y: rY,
      percentile1M: p1,
      percentile3M: p3,
      percentile1Y: pY,
      pctFrom52WHigh,
      cmpChangePct,
      isWithin52WHigh: isWithin52W,
      isOverlappingWinner: isOverlapping,
      compositeMomentumScore: compositeScore,
      rebalanceStatus,
    };
  });

  // 3. Extract overlapping winners
  const overlappingWinners = processedStocks.filter((s) => s.isOverlappingWinner);

  // 4. Calculate sector tailwinds
  const sectorCountMap = new Map<string, { winnerCount: number; totalCount: number }>();
  processedStocks.forEach((s) => {
    const existing = sectorCountMap.get(s.sector) || { winnerCount: 0, totalCount: 0 };
    existing.totalCount += 1;
    if (s.isOverlappingWinner) {
      existing.winnerCount += 1;
    }
    sectorCountMap.set(s.sector, existing);
  });

  const sectorTailwinds: SectorTailwindInfo[] = Array.from(sectorCountMap.entries())
    .map(([sector, counts]) => {
      const percentageOfOverlapping =
        overlappingWinners.length > 0
          ? Number(((counts.winnerCount / overlappingWinners.length) * 100).toFixed(1))
          : 0;
      // Rule: Sector Tailwinds indicated if >= 4 overlapping stocks or >= 20% of winners
      const isTailwind = counts.winnerCount >= 4 || (overlappingWinners.length >= 5 && percentageOfOverlapping >= 20);
      return {
        sector,
        overlappingCount: counts.winnerCount,
        totalInSector: counts.totalCount,
        percentageOfOverlapping,
        isTailwind,
      };
    })
    .filter((st) => st.overlappingCount > 0)
    .sort((a, b) => b.overlappingCount - a.overlappingCount);

  // Stats summary
  const dominantSector = sectorTailwinds.length > 0 ? `${sectorTailwinds[0].sector} (${sectorTailwinds[0].overlappingCount} stocks)` : 'None';
  const within52WHighCount = processedStocks.filter((s) => s.isWithin52WHigh).length;

  const avgWinner1M =
    overlappingWinners.length > 0
      ? Number((overlappingWinners.reduce((acc, s) => acc + s.return1M, 0) / overlappingWinners.length).toFixed(1))
      : 0;
  const avgWinner3M =
    overlappingWinners.length > 0
      ? Number((overlappingWinners.reduce((acc, s) => acc + s.return3M, 0) / overlappingWinners.length).toFixed(1))
      : 0;
  const avgWinner1Y =
    overlappingWinners.length > 0
      ? Number((overlappingWinners.reduce((acc, s) => acc + s.return1Y, 0) / overlappingWinners.length).toFixed(1))
      : 0;

  return {
    processedStocks,
    overlappingWinners,
    sectorTailwinds,
    stats: {
      totalUniverse: n,
      winnerCount: overlappingWinners.length,
      within52WHighCount,
      within52WCount: within52WHighCount,
      dominantSector,
      avgWinner1MReturn: avgWinner1M,
      avgWinner3MReturn: avgWinner3M,
      avgWinner1YReturn: avgWinner1Y,
    },
  };
}

/**
 * Generates an equal-weighted portfolio allocation based on top momentum winners
 */
export function buildEqualWeightPortfolio(
  winners: StockRecord[],
  config: PortfolioAllocation
): {
  positions: AllocatedPosition[];
  totalInvested: number;
  remainingCash: number;
  averageExpectedReturn: number;
} {
  const targetStocks = winners.slice(0, config.topNStocks);
  if (targetStocks.length === 0) {
    return {
      positions: [],
      totalInvested: 0,
      remainingCash: config.totalCapital,
      averageExpectedReturn: 0,
    };
  }

  const weightPerStock = 100 / targetStocks.length;
  const targetCapitalPerStock = config.totalCapital / targetStocks.length;

  let totalInvested = 0;
  const positions: AllocatedPosition[] = targetStocks.map((stock) => {
    // Quant allocations are benchmarked to Last Completed Session Close
    const benchmarkPrice = stock.lastClose || stock.cmp;
    const shares = Math.max(1, Math.floor(targetCapitalPerStock / benchmarkPrice));
    const investedAmount = shares * benchmarkPrice;
    totalInvested += investedAmount;

    // Stop loss and target price benchmarked to Last Completed Session Close
    const stopLossPrice = Number((benchmarkPrice * (1 - config.stopLossPct / 100)).toFixed(1));
    const targetPrice = Number((benchmarkPrice * (1 + config.targetGainPct / 100)).toFixed(1));

    return {
      stock,
      weightPct: Number(weightPerStock.toFixed(1)),
      allocatedAmount: Number(targetCapitalPerStock.toFixed(0)),
      shares,
      investedAmount,
      stopLossPrice,
      targetPrice,
    };
  });

  const remainingCash = Math.max(0, config.totalCapital - totalInvested);
  const averageExpectedReturn = config.targetGainPct;

  return {
    positions,
    totalInvested,
    remainingCash,
    averageExpectedReturn,
  };
}
