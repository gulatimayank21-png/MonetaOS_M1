import {
  StockRecord,
  FilterSettings,
  SectorTailwindInfo,
  PortfolioAllocation,
  AllocatedPosition,
  PortfolioWeightStrategy,
} from '../types';

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

  // Determine qualification cutoff threshold (user selected threshold)
  const cutoffRank =
    filters.mode === 'percentile'
      ? Math.max(1, Math.ceil((filters.percentileThreshold / 100) * n))
      : Math.min(n, filters.topCountThreshold);

  // Standard Macro-Universe Baseline Cutoff (Top 25% across universe) to assess sector breadth
  const macroBaselineCutoff = Math.max(1, Math.ceil(0.25 * n));

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

    // Super-Trend Filter: Top 25% (or user cutoffRank) on 1M, 3M, and 1Y
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
  // A true sector tailwind requires statistically significant institutional concentration.
  // We compute each sector's active winner count, baseline momentum density, and rank the sectors.
  const sectorCountMap = new Map<
    string,
    {
      activeWinnerCount: number;
      baselineWinnerCount: number;
      totalCount: number;
      totalMomentumSum: number;
    }
  >();

  processedStocks.forEach((s) => {
    const existing = sectorCountMap.get(s.sector) || {
      activeWinnerCount: 0,
      baselineWinnerCount: 0,
      totalCount: 0,
      totalMomentumSum: 0,
    };
    existing.totalCount += 1;
    existing.totalMomentumSum += (s.compositeMomentumScore || 0);

    if (s.isOverlappingWinner) {
      existing.activeWinnerCount += 1;
    }

    // High conviction macro baseline leadership: In Top 20% on 1M, 3M, 1Y and near 52W High
    const inBase1M = (s.rank1M || n) <= Math.ceil(0.20 * n);
    const inBase3M = (s.rank3M || n) <= Math.ceil(0.20 * n);
    const inBase1Y = (s.rank1Y || n) <= Math.ceil(0.20 * n);
    const isNear52W = Math.abs(s.pctFrom52WHigh || 0) <= 8;
    if (inBase1M && inBase3M && inBase1Y && isNear52W) {
      existing.baselineWinnerCount += 1;
    }

    sectorCountMap.set(s.sector, existing);
  });

  // Calculate sector scores
  const evaluatedSectors = Array.from(sectorCountMap.entries())
    .map(([sector, counts]) => {
      const percentageOfOverlapping =
        overlappingWinners.length > 0
          ? Number(((counts.activeWinnerCount / overlappingWinners.length) * 100).toFixed(1))
          : 0;

      const sectorBreadthPct = counts.totalCount > 0
        ? Number(((counts.baselineWinnerCount / counts.totalCount) * 100).toFixed(1))
        : 0;

      const avgSectorMomentum = counts.totalCount > 0
        ? Number((counts.totalMomentumSum / counts.totalCount).toFixed(1))
        : 0;

      // Primary score used to rank sectors by institutional momentum concentration
      const sectorScore =
        counts.activeWinnerCount * 10 +
        counts.baselineWinnerCount * 4 +
        sectorBreadthPct * 0.5 +
        avgSectorMomentum * 0.1;

      return {
        sector,
        activeWinnerCount: counts.activeWinnerCount,
        baselineWinnerCount: counts.baselineWinnerCount,
        totalInSector: counts.totalCount,
        sectorBreadthPct,
        percentageOfOverlapping,
        sectorScore,
      };
    })
    .sort((a, b) => b.sectorScore - a.sectorScore);

  // Strict Tailwind Rule:
  // 1. Only top 2 to 3 leading sectors across the entire universe can have a Tailwind at any given time.
  // 2. The sector must have at least 2 active winners (or >=20% of all winners if winners are few),
  //    OR have >=4 high-conviction macro baseline leaders with >=12% sector density.
  const sectorTailwinds: SectorTailwindInfo[] = evaluatedSectors.map((sec, rankIdx) => {
    const isTopRankedSector = rankIdx < 3; // Top 3 leading sectors maximum

    const meetsActiveThreshold =
      (sec.activeWinnerCount >= 2 && isTopRankedSector) ||
      (overlappingWinners.length >= 2 && sec.percentageOfOverlapping >= 20);

    const meetsMacroBreadthThreshold =
      isTopRankedSector && sec.baselineWinnerCount >= 4 && sec.sectorBreadthPct >= 12;

    const isTailwind = isTopRankedSector && (meetsActiveThreshold || meetsMacroBreadthThreshold);

    return {
      sector: sec.sector,
      overlappingCount: sec.activeWinnerCount,
      baselineWinnerCount: sec.baselineWinnerCount,
      sectorBreadthPct: sec.sectorBreadthPct,
      totalInSector: sec.totalInSector,
      percentageOfOverlapping: sec.percentageOfOverlapping,
      isTailwind,
    };
  });

  // Stats summary
  const dominantTailwind = sectorTailwinds.find((st) => st.isTailwind);
  const dominantSector = dominantTailwind
    ? `${dominantTailwind.sector} (${dominantTailwind.overlappingCount > 0 ? `${dominantTailwind.overlappingCount} in Top ${filters.percentileThreshold}%` : `${dominantTailwind.baselineWinnerCount} Macro Leaders`})`
    : sectorTailwinds.length > 0
    ? `${sectorTailwinds[0].sector} (${sectorTailwinds[0].overlappingCount} stocks)`
    : 'None';

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
 * Generates an institutional weighted portfolio allocation based on momentum scores,
 * ranking decay, sector tailwinds, and position risk caps.
 */
export function buildWeightedPortfolio(
  winners: StockRecord[],
  config: PortfolioAllocation,
  sectorTailwinds: SectorTailwindInfo[] = []
): {
  positions: AllocatedPosition[];
  totalInvested: number;
  remainingCash: number;
  averageExpectedReturn: number;
  strategySummary: {
    strategy: PortfolioWeightStrategy;
    topPositionWeight: number;
    lowestPositionWeight: number;
    tailwindBoostedCount: number;
  };
} {
  const targetStocks = winners.slice(0, config.topNStocks);
  const strategy: PortfolioWeightStrategy = config.weightStrategy || 'multi_factor';

  if (targetStocks.length === 0) {
    return {
      positions: [],
      totalInvested: 0,
      remainingCash: config.totalCapital,
      averageExpectedReturn: 0,
      strategySummary: {
        strategy,
        topPositionWeight: 0,
        lowestPositionWeight: 0,
        tailwindBoostedCount: 0,
      },
    };
  }

  // Create lookup set of active Tailwind sectors
  const tailwindSectorSet = new Set(
    sectorTailwinds.filter((st) => st.isTailwind).map((st) => st.sector)
  );

  const tailwindBoostFactor = 1 + (config.tailwindBoostPct || 25) / 100; // e.g. 1.25 (+25% boost)
  const maxCapPct = config.maxPositionWeightPct || 25; // e.g. 25% single-stock maximum limit

  // 1. Compute Raw Unconstrained Alpha Weights
  const rawWeights: number[] = targetStocks.map((stock, idx) => {
    const rankNum = idx + 1;
    const score = Math.max(1, stock.compositeMomentumScore || 75);
    const inTailwind = tailwindSectorSet.has(stock.sector);
    const tailwindMultiplier = inTailwind ? tailwindBoostFactor : 1.0;
    const safeAtrPct = Math.max(0.8, stock.atrPct || 2.5);

    switch (strategy) {
      case 'atr_momentum_parity': {
        // Volatility-Adjusted Momentum: Score / ATR% * Rank Decay * Tailwind Boost
        const scoreAlpha = Math.pow(score / 100, 1.5);
        const rankDecay = 1 / Math.sqrt(rankNum);
        return (scoreAlpha / safeAtrPct) * rankDecay * tailwindMultiplier;
      }
      case 'atr_inverse_vol': {
        // Pure Risk Parity: Inverse 14-day ATR%
        return 1 / safeAtrPct;
      }
      case 'multi_factor': {
        // Multi-Factor Alpha Sizing: Composite Score Power * Rank Decay * Sector Tailwind Boost
        const scoreAlpha = Math.pow(score / 100, 2);
        const rankDecay = 1 / Math.sqrt(rankNum);
        return scoreAlpha * rankDecay * tailwindMultiplier;
      }
      case 'composite_score': {
        // Pure Score Weighting (Cubic spread to reward top 95+ scores)
        return Math.pow(score / 100, 3);
      }
      case 'rank_decay': {
        // Inverse Rank Power Decay
        return 1 / Math.pow(rankNum, 0.65);
      }
      case 'tailwind_tilted': {
        // 2x allocation boost to stocks riding institutional sector tailwinds
        return (inTailwind ? 2.2 : 1.0) * (score / 100);
      }
      case 'equal_weight':
      default:
        return 1.0;
    }
  });

  // 2. Initial Normalization to 100%
  const totalRawWeight = rawWeights.reduce((a, b) => a + b, 0);
  let normalizedWeights = rawWeights.map((rw) => (rw / totalRawWeight) * 100);

  // 3. Apply Single-Stock Position Cap with Iterative Excess Redistribution
  if (strategy !== 'equal_weight' && normalizedWeights.some((w) => w > maxCapPct)) {
    let cappedWeights = [...normalizedWeights];
    let isCapped = new Array(cappedWeights.length).fill(false);
    let iterations = 0;

    while (iterations < 5) {
      let excessWeight = 0;
      let uncappedSum = 0;

      for (let i = 0; i < cappedWeights.length; i++) {
        if (!isCapped[i] && cappedWeights[i] > maxCapPct) {
          excessWeight += cappedWeights[i] - maxCapPct;
          cappedWeights[i] = maxCapPct;
          isCapped[i] = true;
        } else if (!isCapped[i]) {
          uncappedSum += cappedWeights[i];
        }
      }

      if (excessWeight <= 0.001 || uncappedSum <= 0) break;

      // Redistribute excess proportionally to uncapped assets
      for (let i = 0; i < cappedWeights.length; i++) {
        if (!isCapped[i]) {
          cappedWeights[i] += excessWeight * (cappedWeights[i] / uncappedSum);
        }
      }
      iterations++;
    }
    normalizedWeights = cappedWeights;
  }

  // 4. Determine Conviction Tiers
  let tailwindBoostedCount = 0;
  let totalInvested = 0;

  const positions: AllocatedPosition[] = targetStocks.map((stock, idx) => {
    const weightPct = Number(normalizedWeights[idx].toFixed(2));
    const targetCapitalForStock = (config.totalCapital * weightPct) / 100;
    const benchmarkPrice = stock.lastClose || stock.cmp;
    const shares = Math.max(1, Math.floor(targetCapitalForStock / benchmarkPrice));
    const investedAmount = shares * benchmarkPrice;
    totalInvested += investedAmount;

    const stopLossPrice = Number((benchmarkPrice * (1 - config.stopLossPct / 100)).toFixed(1));
    const targetPrice = Number((benchmarkPrice * (1 + config.targetGainPct / 100)).toFixed(1));

    const inTailwind = tailwindSectorSet.has(stock.sector);
    if (inTailwind) tailwindBoostedCount++;

    // Conviction Tiers
    let convictionTier: 'High Alpha' | 'Core Momentum' | 'Emerging Trend' = 'Core Momentum';
    if (idx < Math.ceil(targetStocks.length * 0.3) && weightPct > (100 / targetStocks.length)) {
      convictionTier = 'High Alpha';
    } else if (idx >= Math.floor(targetStocks.length * 0.7)) {
      convictionTier = 'Emerging Trend';
    }

    return {
      stock,
      weightPct,
      allocatedAmount: Number(targetCapitalForStock.toFixed(0)),
      shares,
      investedAmount,
      stopLossPrice,
      targetPrice,
      convictionTier,
      hasTailwindBoost: inTailwind,
    };
  });

  const remainingCash = Math.max(0, config.totalCapital - totalInvested);
  const averageExpectedReturn = config.targetGainPct;

  const topPositionWeight = Math.max(...positions.map((p) => p.weightPct));
  const lowestPositionWeight = Math.min(...positions.map((p) => p.weightPct));

  return {
    positions,
    totalInvested,
    remainingCash,
    averageExpectedReturn,
    strategySummary: {
      strategy,
      topPositionWeight,
      lowestPositionWeight,
      tailwindBoostedCount,
    },
  };
}

/**
 * Backward-compatible helper for equal-weight portfolios
 */
export function buildEqualWeightPortfolio(
  winners: StockRecord[],
  config: PortfolioAllocation,
  sectorTailwinds: SectorTailwindInfo[] = []
) {
  return buildWeightedPortfolio(
    winners,
    { ...config, weightStrategy: 'equal_weight' },
    sectorTailwinds
  );
}
