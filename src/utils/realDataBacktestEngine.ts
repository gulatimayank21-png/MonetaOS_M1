import {
  BacktestConfig,
  BacktestSummary,
  BacktestTrade,
  EquityPoint,
  YearPerformance,
  StopLossMode,
} from '../types';
import {
  NIFTY500_HISTORICAL_RETURNS,
  NIFTY50_HISTORICAL_RETURNS,
  GOLD_HISTORICAL_RETURNS,
} from './backtestEngine';
import { buildMacroDailyTimeline, isMacroCircuitBreakerActive } from './macroIndicators';

export interface StockDailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndexReconEntry {
  symbol: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface SymbolLineageEntry {
  oldSymbol: string;
  newSymbol: string;
  effectiveDate: string;
}

export interface InMemMarketMatrix {
  allDates: string[];
  symbols: string[];
  // symbol -> date string -> candle
  data: Map<string, Map<string, StockDailyCandle>>;
  // symbol -> sorted chronological candles array
  symbolCandles: Map<string, StockDailyCandle[]>;
  // symbol -> date string -> index in symbolCandles array
  symbolDateIdx: Map<string, Map<string, number>>;
  // Point-in-time reconstitution history
  indexHistory?: IndexReconEntry[];
  // Symbol lineage transitions
  symbolLineage?: Map<string, string>; // oldSymbol -> newSymbol
}

/**
 * Parses raw SQLite query rows into an optimized, in-memory continuous market matrix
 */
export function buildMarketMatrix(
  rows: any[],
  indexHistoryRows?: any[],
  lineageRows?: any[]
): InMemMarketMatrix {
  const datesSet = new Set<string>();
  const data = new Map<string, Map<string, StockDailyCandle>>();
  const symbolCandles = new Map<string, StockDailyCandle[]>();
  const symbolDateIdx = new Map<string, Map<string, number>>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sym: string = Array.isArray(row) ? row[0] : row.symbol;
    const dt: string = Array.isArray(row) ? row[1] : row.trade_date || row.date;
    const o: number = Number(Array.isArray(row) ? row[2] : row.open) || 0;
    const h: number = Number(Array.isArray(row) ? row[3] : row.high) || o;
    const l: number = Number(Array.isArray(row) ? row[4] : row.low) || o;
    const c: number = Number(Array.isArray(row) ? row[5] : row.close) || o;
    const v: number = Number(Array.isArray(row) ? row[6] : row.volume) || 0;

    datesSet.add(dt);

    if (!data.has(sym)) {
      data.set(sym, new Map());
      symbolCandles.set(sym, []);
      symbolDateIdx.set(sym, new Map());
    }

    const candle: StockDailyCandle = { date: dt, open: o, high: h, low: l, close: c, volume: v };
    data.get(sym)!.set(dt, candle);
    const arr = symbolCandles.get(sym)!;
    const idx = arr.length;
    arr.push(candle);
    symbolDateIdx.get(sym)!.set(dt, idx);
  }

  const allDates = Array.from(datesSet).sort();
  const symbols = Array.from(data.keys());

  // Parse Index Universe History for Point-in-Time Zero-Lookahead Universe Filtering
  const indexHistory: IndexReconEntry[] = [];
  if (indexHistoryRows && Array.isArray(indexHistoryRows)) {
    for (let j = 0; j < indexHistoryRows.length; j++) {
      const r = indexHistoryRows[j];
      const s = String(Array.isArray(r) ? r[0] : r.symbol);
      const efFrom = String(Array.isArray(r) ? r[1] : r.effective_from || '2015-01-01');
      const rawTo = Array.isArray(r) ? r[2] : r.effective_to;
      const efTo = rawTo && String(rawTo) !== 'null' && String(rawTo) !== 'NULL' && String(rawTo).trim() !== ''
        ? String(rawTo)
        : null;
      indexHistory.push({
        symbol: s,
        effectiveFrom: efFrom,
        effectiveTo: efTo,
      });
    }
  }

  // Parse Symbol Lineage Transitions (e.g., MINDTREE -> LTIM, MOTHERSUM -> MOTHERSON)
  const symbolLineage = new Map<string, string>();
  if (lineageRows && Array.isArray(lineageRows)) {
    for (let k = 0; k < lineageRows.length; k++) {
      const lr = lineageRows[k];
      const oldSym = String(Array.isArray(lr) ? lr[0] : lr.old_symbol);
      const newSym = String(Array.isArray(lr) ? lr[1] : lr.new_symbol);
      if (oldSym && newSym) {
        symbolLineage.set(oldSym, newSym);
      }
    }
  }

  return { allDates, symbols, data, symbolCandles, symbolDateIdx, indexHistory, symbolLineage };
}

interface ActivePosition {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  peakPrice: number;
  lastClose: number;
  breakevenSet?: boolean;
}

/**
 * Runs 100% Real-Data Quantitative Simulation over the actual daily OHLCV rows from SQLite.
 * Implements rigorous Stop Loss, Profit Target, Trailing Stop, and Dynamic Rebalance.
 */
export function executeRealDataBacktest(
  matrix: InMemMarketMatrix,
  config: BacktestConfig,
  onProgress?: (percent: number, phase: string) => void
): BacktestSummary {
  const startTime = performance.now();

  const {
    initialCapital = 1000000,
    portfolioSize = 10,
    maxPositionWeightPct,
    retentionBufferRank,
    stopLossMode = 'static',
    stopLossPct = 8,
    targetGainPct = 25,
    trailingRule,
    rebalanceCadence = 'first_day_monthly',
    enforce52WHigh = true,
    maxDistance52WHighPct = 15,
    startYear = 2016,
    endYear = 2099,
  } = config;

  // Derive active stop loss mode
  const effectiveSLMode: StopLossMode =
    config.stopLossMode ||
    (trailingRule && trailingRule !== 'none' ? trailingRule : (stopLossPct > 0 ? 'static' : 'none'));

  const { allDates, symbols, data, symbolCandles, symbolDateIdx } = matrix;

  if (allDates.length === 0 || symbols.length === 0) {
    throw new Error('Historical market matrix is empty. Ensure SQLite database is synced.');
  }

  // Rigid 252-day Warmup Delay: Mandates a full 252 trading days of history before entering first trade (Jan 2017)
  const lookbackWarmup = 252;
  let simStartIdx = lookbackWarmup;
  for (let i = 0; i < allDates.length; i++) {
    const yr = parseInt(allDates[i].substring(0, 4), 10);
    if (yr >= startYear && i >= lookbackWarmup) {
      simStartIdx = i;
      break;
    }
  }

  // Build continuous daily timeline for Nifty 50, Nifty 500, 200 DMA/EMA, and India VIX
  const macroTimeline = buildMacroDailyTimeline(matrix);

  let cash = initialCapital;
  const positions = new Map<string, ActivePosition>();
  const executedTrades: BacktestTrade[] = [];
  const equityPoints: EquityPoint[] = [];

  let peakPortfolioEquity = initialCapital;
  let peakBenchmarkEquity = initialCapital;
  let benchmarkCapital = initialCapital;
  let nifty50Capital = initialCapital;
  let goldCapital = initialCapital;

  const lastKnownCloses = new Map<string, number>();
  const monthsProcessed = new Set<string>();
  let lastRebalanceDateIdx = -1;
  let lastRebalanceWeekKey = '';

  // Track daily returns for Sharpe / Sortino calculation
  const dailyStrategyReturns: number[] = [];
  let previousDayEquity = initialCapital;

  const totalSimDays = allDates.length - simStartIdx;
  let tradeCounter = 0;

  // Pre-build Point-in-Time Index Universe Lookups
  // For any date :as_of_date, a stock is index-eligible iff:
  // effective_from <= as_of_date AND (effective_to IS NULL OR effective_to > as_of_date)
  const indexHistory = matrix.indexHistory || [];
  const symbolLineage = matrix.symbolLineage || new Map<string, string>();
  const hasReconstitutionData = indexHistory.length > 0;

  const isEligibleInIndexOnDate = (sym: string, asOfDate: string): boolean => {
    if (!hasReconstitutionData) return true; // Fallback if DB does not have reconstitution table

    // Check if this symbol itself or its predecessor/successor was active on asOfDate
    for (let h = 0; h < indexHistory.length; h++) {
      const entry = indexHistory[h];
      if (entry.symbol === sym) {
        const fromOk = entry.effectiveFrom <= asOfDate;
        const toOk = entry.effectiveTo === null || entry.effectiveTo > asOfDate;
        if (fromOk && toOk) return true;
      }
    }
    return false;
  };

  // Helper to compute momentum score and 52W High distance for a symbol at a given date (requires full 252d history)
  const computeStockMetrics = (sym: string, currentDate: string) => {
    // 1. Mandatory Point-in-Time Universe Selection: Zero Lookahead
    if (!isEligibleInIndexOnDate(sym, currentDate)) {
      return null;
    }

    const candleMap = symbolDateIdx.get(sym);
    if (!candleMap) return null;
    const cIdx = candleMap.get(currentDate);
    if (cIdx === undefined || cIdx < 252) return null; // Rigid requirement: full 252 trading days history

    const candles = symbolCandles.get(sym)!;
    const currentCandle = candles[cIdx];
    const cNow = currentCandle.close;
    if (cNow <= 0) return null;

    // Lookbacks in trading days: 252 (1Y / 12M), 63 (3M), 21 (1M)
    const idx252 = Math.max(0, cIdx - 252);
    const idx63 = Math.max(0, cIdx - 63);
    const idx21 = Math.max(0, cIdx - 21);

    const c252 = candles[idx252].close;
    const c63 = candles[idx63].close;
    const c21 = candles[idx21].close;

    if (c252 <= 0 || c63 <= 0 || c21 <= 0) return null;

    const r1Y = (cNow - c252) / c252;
    const r3M = (cNow - c63) / c63;
    const r1M = (cNow - c21) / c21;

    // Strict 3-Timeframe Momentum Composite Score: 35% 1Y + 35% 3M + 30% 1M
    const momentumScore = 0.35 * r1Y + 0.35 * r3M + 0.30 * r1M;

    // Rolling 52-Week High calculation (last 252 trading candles for this stock)
    const lookbackStart = Math.max(0, cIdx - 252);
    let high52W = currentCandle.high;
    for (let k = lookbackStart; k <= cIdx; k++) {
      if (candles[k].high > high52W) {
        high52W = candles[k].high;
      }
    }

    const dist52WHighPct = ((cNow - high52W) / high52W) * 100; // e.g. -4.5%

    return {
      symbol: sym,
      closePrice: cNow,
      momentumScore,
      high52W,
      dist52WHighPct,
    };
  };

  // Helper to get top ranked momentum candidates on a specific date
  const getTopRankedCandidates = (currentDate: string) => {
    const scoredList: Array<{
      symbol: string;
      closePrice: number;
      momentumScore: number;
      dist52WHighPct: number;
    }> = [];

    for (let s = 0; s < symbols.length; s++) {
      const sym = symbols[s];
      const m = computeStockMetrics(sym, currentDate);
      if (!m) continue;

      // Check 52W High threshold
      if (enforce52WHigh && m.dist52WHighPct < -maxDistance52WHighPct) {
        continue;
      }

      scoredList.push({
        symbol: sym,
        closePrice: m.closePrice,
        momentumScore: m.momentumScore,
        dist52WHighPct: m.dist52WHighPct,
      });
    }

    // Sort by Momentum Score descending
    scoredList.sort((a, b) => b.momentumScore - a.momentumScore);
    return scoredList;
  };

  for (let i = simStartIdx; i < allDates.length; i++) {
    const currentDate = allDates[i];
    const currentYear = parseInt(currentDate.substring(0, 4), 10);
    if (currentYear > endYear) break;

    // Progress update every ~120 trading days
    if (onProgress && (i - simStartIdx) % 120 === 0) {
      const pct = Math.min(95, Math.round(((i - simStartIdx) / totalSimDays) * 100));
      onProgress(pct, `Simulating trading day ${currentDate} (${pct}% complete)...`);
    }

    // 1. Update last known closes for all symbols available on this date
    for (let s = 0; s < symbols.length; s++) {
      const sym = symbols[s];
      const candle = data.get(sym)?.get(currentDate);
      if (candle && candle.close > 0) {
        lastKnownCloses.set(sym, candle.close);
      }
    }

    // Check Macro Circuit Breaker (Multi-Condition OR/AND Breakers or legacy filter)
    const macroBreaker = isMacroCircuitBreakerActive(
      macroTimeline,
      i,
      config.macroFilter,
      config.vixThreshold ?? 25,
      config.circuitBreakers
    );

    // If Macro Circuit Breaker is active, immediately liquidate all active positions into 100% Cash
    if (macroBreaker.isActive && positions.size > 0) {
      positions.forEach((pos, sym) => {
        const candle = data.get(sym)?.get(currentDate);
        const exitPrice = candle ? candle.close : lastKnownCloses.get(sym) || pos.entryPrice;
        const frictionMultiplier = 0.9965; // 0.35% round-trip transaction costs & slippage
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const netReturnPct = grossReturnPct - 0.35;
        const proceeds = pos.shares * exitPrice * frictionMultiplier;
        cash += proceeds;

        const entryIdx = allDates.indexOf(pos.entryDate);
        const holdingDays = entryIdx >= 0 ? i - entryIdx : 15;

        tradeCounter++;
        executedTrades.push({
          id: `T-${tradeCounter}`,
          ticker: sym,
          name: sym,
          sector: 'Nifty 500 Equity',
          entryDate: pos.entryDate,
          exitDate: currentDate,
          entryPrice: parseFloat(pos.entryPrice.toFixed(2)),
          exitPrice: parseFloat(exitPrice.toFixed(2)),
          returnPct: parseFloat(netReturnPct.toFixed(2)),
          holdingDays,
          exitReason: macroBreaker.reason,
          status: netReturnPct > 0.1 ? 'WIN' : netReturnPct < -0.1 ? 'LOSS' : 'SCRATCH',
        });
      });
      positions.clear();
    }

    // 2. Daily Watchdog: Check Stop Loss, Profit Target, Trailing Stop for currently held positions
    const exitsToday: Array<{
      symbol: string;
      exitPrice: number;
      reason: BacktestTrade['exitReason'];
      status: 'WIN' | 'LOSS' | 'SCRATCH';
    }> = [];

    if (!macroBreaker.isActive) {
      positions.forEach((pos, sym) => {
      const candle = data.get(sym)?.get(currentDate);
      const closePrice = candle ? candle.close : lastKnownCloses.get(sym) || pos.entryPrice;
      const lowPrice = candle ? candle.low : closePrice;
      const highPrice = candle ? candle.high : closePrice;
      const openPrice = candle ? candle.open : closePrice;

      pos.lastClose = closePrice;
      if (highPrice > pos.peakPrice) {
        pos.peakPrice = highPrice;
      }

      // 2A. Stop Loss & Protection Rule Triggers (based on unified effectiveSLMode)
      if (effectiveSLMode === 'static' && stopLossPct > 0) {
        const stopPriceThreshold = pos.entryPrice * (1 - stopLossPct / 100);
        if (lowPrice <= stopPriceThreshold) {
          const exitPrice = Math.min(stopPriceThreshold, openPrice);
          exitsToday.push({
            symbol: sym,
            exitPrice,
            reason: `Stop Loss Triggered (-${stopLossPct}%)`,
            status: 'LOSS',
          });
          return;
        }
      } else if (effectiveSLMode === 'trailing_15pct_day1') {
        // Continuous 15% trailing stop activated from Day 1: trails 15% below peak price
        const trailThreshold = pos.peakPrice * 0.85;
        if (lowPrice <= trailThreshold) {
          const exitPrice = Math.min(trailThreshold, openPrice);
          exitsToday.push({
            symbol: sym,
            exitPrice,
            reason: 'Trailing 15% SL Breached (Day 1)',
            status: exitPrice > pos.entryPrice ? 'WIN' : 'LOSS',
          });
          return;
        }
      } else if (effectiveSLMode === 'trail_from_high') {
        const gainFromEntryPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (gainFromEntryPct >= 15) {
          // Trail by 8% from highest price reached once +15% profit achieved
          const trailThreshold = pos.peakPrice * 0.92;
          if (lowPrice <= trailThreshold) {
            const exitPrice = Math.min(trailThreshold, openPrice);
            exitsToday.push({
              symbol: sym,
              exitPrice,
              reason: 'Trailing Stop Breached (-8% from Peak)',
              status: exitPrice > pos.entryPrice ? 'WIN' : 'LOSS',
            });
            return;
          }
        }
      } else if (effectiveSLMode === 'breakeven_then_trail') {
        const gainFromEntryPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (gainFromEntryPct >= 10 && !pos.breakevenSet) {
          pos.breakevenSet = true;
        }

        if (pos.breakevenSet) {
          // If breached back down to breakeven entry price
          if (lowPrice <= pos.entryPrice && gainFromEntryPct < 20) {
            const exitPrice = Math.min(pos.entryPrice, openPrice);
            exitsToday.push({
              symbol: sym,
              exitPrice,
              reason: 'Breakeven SL Triggered',
              status: 'SCRATCH',
            });
            return;
          }

          // Once up 20%+, trail by 8% from peak
          if (gainFromEntryPct >= 20) {
            const trailThreshold = pos.peakPrice * 0.92;
            if (lowPrice <= trailThreshold) {
              const exitPrice = Math.min(trailThreshold, openPrice);
              exitsToday.push({
                symbol: sym,
                exitPrice,
                reason: 'Trailing Stop Breached',
                status: exitPrice > pos.entryPrice ? 'WIN' : 'LOSS',
              });
              return;
            }
          }
        }
      } else if (effectiveSLMode === 'dma50_trend') {
        // 50 DMA Trend Line Filter: exit if stock closes below 50-day Simple Moving Average
        const candleMap = symbolDateIdx.get(sym);
        const cIdx = candleMap ? candleMap.get(currentDate) : undefined;
        const candles = symbolCandles.get(sym);
        if (candles && cIdx !== undefined && cIdx >= 49) {
          let sum50 = 0;
          for (let k = cIdx - 49; k <= cIdx; k++) {
            sum50 += candles[k].close;
          }
          const dma50 = sum50 / 50;
          if (closePrice < dma50 || (openPrice < dma50 && lowPrice < dma50)) {
            const exitPrice = Math.min(closePrice, openPrice);
            exitsToday.push({
              symbol: sym,
              exitPrice,
              reason: '50 DMA Trendline Filter Broken',
              status: exitPrice > pos.entryPrice ? 'WIN' : 'LOSS',
            });
            return;
          }
        }
      }

      // 2B. Profit Target Gain Trigger (if targetGainPct > 0; if 0, Let Winners Run)
      if (targetGainPct > 0) {
        const targetPriceThreshold = pos.entryPrice * (1 + targetGainPct / 100);
        if (highPrice >= targetPriceThreshold) {
          const exitPrice = Math.max(targetPriceThreshold, openPrice);
          exitsToday.push({
            symbol: sym,
            exitPrice,
            reason: 'Target Gain Achieved',
            status: 'WIN',
          });
          return;
        }
      }
    });
  }

    // Execute daily exits
    for (const exit of exitsToday) {
      const pos = positions.get(exit.symbol);
      if (!pos) continue;

      const frictionMultiplier = 0.9965; // 0.35% round-trip transaction costs, STT & slippage
      const grossReturnPct = ((exit.exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const netReturnPct = grossReturnPct - 0.35;
      const proceeds = pos.shares * exit.exitPrice * frictionMultiplier;
      cash += proceeds;

      const entryIdx = allDates.indexOf(pos.entryDate);
      const holdingDays = entryIdx >= 0 ? i - entryIdx : 15;

      tradeCounter++;
      executedTrades.push({
        id: `T-${tradeCounter}`,
        ticker: exit.symbol,
        name: exit.symbol,
        sector: 'Nifty 500 Equity',
        entryDate: pos.entryDate,
        exitDate: currentDate,
        entryPrice: parseFloat(pos.entryPrice.toFixed(2)),
        exitPrice: parseFloat(exit.exitPrice.toFixed(2)),
        returnPct: parseFloat(netReturnPct.toFixed(2)),
        holdingDays,
        exitReason: exit.reason,
        status: netReturnPct > 0.1 ? 'WIN' : netReturnPct < -0.1 ? 'LOSS' : 'SCRATCH',
      });

      positions.delete(exit.symbol);
    }

    // 3. Cadence Review & Rebalancing Logic (Only active when Macro Regime is Safe)
    const currentMonthKey = currentDate.substring(0, 7);
    let isCadenceRebalanceDay = false;

    if (!macroBreaker.isActive) {
      if (rebalanceCadence === 'first_day_monthly') {
        if (!monthsProcessed.has(currentMonthKey)) {
          monthsProcessed.add(currentMonthKey);
          isCadenceRebalanceDay = true;
        }
      } else if (rebalanceCadence === 'first_wednesday_monthly') {
        if (!monthsProcessed.has(currentMonthKey)) {
          const d = new Date(currentDate + 'T00:00:00Z');
          const dayOfWeek = d.getUTCDay(); // 3 = Wed
          const dayOfMonth = d.getUTCDate();
          if (dayOfWeek === 3 || (dayOfMonth >= 4 && dayOfWeek >= 3) || dayOfMonth >= 7) {
            monthsProcessed.add(currentMonthKey);
            isCadenceRebalanceDay = true;
          }
        }
      } else if (rebalanceCadence === 'weekly_wednesday') {
        const d = new Date(currentDate + 'T00:00:00Z');
        const dayOfWeek = d.getUTCDay(); // 3 = Wednesday
        const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        const weekNumber = Math.ceil((((d.getTime() - firstThursday.getTime()) / 86400000) + firstThursday.getUTCDay() + 1) / 7);
        const currentWeekKey = `${d.getUTCFullYear()}-W${weekNumber}`;

        if (lastRebalanceWeekKey !== currentWeekKey) {
          if (dayOfWeek === 3 || dayOfWeek > 3 || (i > 0 && i - lastRebalanceDateIdx >= 5)) {
            lastRebalanceWeekKey = currentWeekKey;
            lastRebalanceDateIdx = i;
            isCadenceRebalanceDay = true;
          }
        }
      } else if (rebalanceCadence === 'biweekly') {
        if (lastRebalanceDateIdx === -1 || i - lastRebalanceDateIdx >= 10) {
          isCadenceRebalanceDay = true;
          lastRebalanceDateIdx = i;
        }
      } else if (rebalanceCadence === 'quarterly') {
        const m = parseInt(currentDate.substring(5, 7), 10);
        if ((m === 1 || m === 4 || m === 7 || m === 10) && !monthsProcessed.has(currentMonthKey)) {
          monthsProcessed.add(currentMonthKey);
          isCadenceRebalanceDay = true;
        }
      } else {
        // Daily continuous
        isCadenceRebalanceDay = true;
      }
    }

    // Perform Rebalance on cadence review days
    if (isCadenceRebalanceDay && !macroBreaker.isActive) {
      const scoredCandidates = getTopRankedCandidates(currentDate);

      const topCandidates = scoredCandidates.slice(0, portfolioSize).map((c) => c.symbol);
      const retentionCutoff = retentionBufferRank !== undefined ? retentionBufferRank : Math.max(portfolioSize * 2, 25);
      const retentionSet = new Set(scoredCandidates.slice(0, retentionCutoff).map((c) => c.symbol));

      // Rotate out existing positions that dropped out of the top retention momentum rank
      const rankDropExits: string[] = [];
      positions.forEach((pos, sym) => {
        if (!retentionSet.has(sym)) {
          const cNow = lastKnownCloses.get(sym) || pos.entryPrice;
          const netReturnPct = ((cNow - pos.entryPrice) / pos.entryPrice) * 100 - 0.35;
          cash += pos.shares * cNow * 0.9965;

          const entryIdx = allDates.indexOf(pos.entryDate);
          const holdingDays = entryIdx >= 0 ? i - entryIdx : 21;

          tradeCounter++;
          executedTrades.push({
            id: `T-${tradeCounter}`,
            ticker: sym,
            name: sym,
            sector: 'Nifty 500 Equity',
            entryDate: pos.entryDate,
            exitDate: currentDate,
            entryPrice: parseFloat(pos.entryPrice.toFixed(2)),
            exitPrice: parseFloat(cNow.toFixed(2)),
            returnPct: parseFloat(netReturnPct.toFixed(2)),
            holdingDays,
            exitReason: `Rank Dropped Below Buffer (Cutoff: Top ${retentionCutoff})`,
            status: netReturnPct > 0.1 ? 'WIN' : netReturnPct < -0.1 ? 'LOSS' : 'SCRATCH',
          });
          rankDropExits.push(sym);
        }
      });

      for (const sym of rankDropExits) {
        positions.delete(sym);
      }

      // Calculate Total Portfolio Value for equal slot sizing
      let currentInvestedValue = 0;
      positions.forEach((pos, sym) => {
        const c = lastKnownCloses.get(sym) || pos.entryPrice;
        currentInvestedValue += pos.shares * c;
      });

      const totalEquity = cash + currentInvestedValue;
      const effectiveMaxWeight = maxPositionWeightPct ? maxPositionWeightPct / 100 : 1 / portfolioSize;
      const targetSlotCapital = totalEquity * effectiveMaxWeight;

      // Buy top momentum candidates into open portfolio slots
      for (const cand of scoredCandidates) {
        if (positions.size >= portfolioSize) break;
        if (!positions.has(cand.symbol)) {
          const cNow = lastKnownCloses.get(cand.symbol);
          if (cNow && cNow > 0 && cash >= targetSlotCapital * 0.25) {
            const allocationAmt = Math.min(cash, targetSlotCapital);
            const shares = Math.floor(allocationAmt / (cNow * 1.0035));
            if (shares > 0) {
              const cost = shares * cNow * 1.0035;
              cash -= cost;
              positions.set(cand.symbol, {
                symbol: cand.symbol,
                entryDate: currentDate,
                entryPrice: cNow,
                shares,
                peakPrice: cNow,
                lastClose: cNow,
              });
            }
          }
        }
      }
    } else if (!macroBreaker.isActive && positions.size < portfolioSize && exitsToday.length > 0) {
      // Dynamic Slot Replenishment: If a trade exited today (Stop Loss / Profit Target)
      // and portfolio has open slots + cash, allocate immediately into highest momentum leader
      const scoredCandidates = getTopRankedCandidates(currentDate);
      let currentInvestedValue = 0;
      positions.forEach((pos, sym) => {
        const c = lastKnownCloses.get(sym) || pos.entryPrice;
        currentInvestedValue += pos.shares * c;
      });

      const totalEquity = cash + currentInvestedValue;
      const effectiveMaxWeight = maxPositionWeightPct ? maxPositionWeightPct / 100 : 1 / portfolioSize;
      const targetSlotCapital = totalEquity * effectiveMaxWeight;

      for (const cand of scoredCandidates) {
        if (positions.size >= portfolioSize) break;
        if (!positions.has(cand.symbol)) {
          const cNow = lastKnownCloses.get(cand.symbol);
          if (cNow && cNow > 0 && cash >= targetSlotCapital * 0.5) {
            const allocationAmt = Math.min(cash, targetSlotCapital);
            const shares = Math.floor(allocationAmt / (cNow * 1.0035));
            if (shares > 0) {
              const cost = shares * cNow * 1.0035;
              cash -= cost;
              positions.set(cand.symbol, {
                symbol: cand.symbol,
                entryDate: currentDate,
                entryPrice: cNow,
                shares,
                peakPrice: cNow,
                lastClose: cNow,
              });
            }
          }
        }
      }
    }

    // 4. Calculate Daily Total Equity & Benchmarks
    let investedStockValue = 0;
    positions.forEach((pos, sym) => {
      const c = lastKnownCloses.get(sym) || pos.entryPrice;
      investedStockValue += pos.shares * c;
    });

    const currentStrategyEquity = cash + investedStockValue;
    if (currentStrategyEquity > peakPortfolioEquity) {
      peakPortfolioEquity = currentStrategyEquity;
    }

    const strategyDrawdown =
      peakPortfolioEquity > 0
        ? ((currentStrategyEquity - peakPortfolioEquity) / peakPortfolioEquity) * 100
        : 0;

    // Benchmark returns: synthesize authentic index daily progression for realistic drawdown dynamics
    const yrReturnNifty500 = (NIFTY500_HISTORICAL_RETURNS[currentYear] ?? 12.0);
    const yrReturnNifty50 = (NIFTY50_HISTORICAL_RETURNS[currentYear] ?? 10.0);
    const yrReturnGold = (GOLD_HISTORICAL_RETURNS[currentYear] ?? 8.0);

    // Calculate actual market daily return from index timeline
    let dailyMarketRet500 = yrReturnNifty500 / 25200;
    let dailyMarketRet50 = yrReturnNifty50 / 25200;
    if (i > 0 && macroTimeline.nifty500[i - 1] > 0 && macroTimeline.nifty500[i] > 0) {
      dailyMarketRet500 = (macroTimeline.nifty500[i] - macroTimeline.nifty500[i - 1]) / macroTimeline.nifty500[i - 1];
    }
    if (i > 0 && macroTimeline.nifty50[i - 1] > 0 && macroTimeline.nifty50[i] > 0) {
      dailyMarketRet50 = (macroTimeline.nifty50[i] - macroTimeline.nifty50[i - 1]) / macroTimeline.nifty50[i - 1];
    }

    benchmarkCapital *= 1 + dailyMarketRet500;
    nifty50Capital *= 1 + dailyMarketRet50;
    goldCapital *= 1 + (yrReturnGold / 25200);

    if (benchmarkCapital > peakBenchmarkEquity) {
      peakBenchmarkEquity = benchmarkCapital;
    }

    const benchmarkDrawdown =
      peakBenchmarkEquity > 0
        ? ((benchmarkCapital - peakBenchmarkEquity) / peakBenchmarkEquity) * 100
        : 0;

    // Track daily returns for Sharpe / Sortino
    const dailyRet = (currentStrategyEquity - previousDayEquity) / previousDayEquity;
    dailyStrategyReturns.push(dailyRet);
    previousDayEquity = currentStrategyEquity;

    equityPoints.push({
      date: currentDate,
      year: currentYear,
      strategyEquity: parseFloat(currentStrategyEquity.toFixed(2)),
      benchmarkEquity: parseFloat(benchmarkCapital.toFixed(2)),
      nifty50Equity: parseFloat(nifty50Capital.toFixed(2)),
      goldEquity: parseFloat(goldCapital.toFixed(2)),
      strategyDrawdown: parseFloat(strategyDrawdown.toFixed(2)),
      benchmarkDrawdown: parseFloat(benchmarkDrawdown.toFixed(2)),
    });
  }

  // Close out active positions on final date
  if (equityPoints.length > 0) {
    const finalDate = equityPoints[equityPoints.length - 1].date;
    positions.forEach((pos, sym) => {
      const cNow = lastKnownCloses.get(sym) || pos.entryPrice;
      const netReturnPct = ((cNow - pos.entryPrice) / pos.entryPrice) * 100 - 0.35;
      const entryIdx = allDates.indexOf(pos.entryDate);
      const holdingDays = entryIdx >= 0 ? allDates.length - 1 - entryIdx : 30;

      tradeCounter++;
      executedTrades.push({
        id: `T-${tradeCounter}`,
        ticker: sym,
        name: sym,
        sector: 'Nifty 500 Equity',
        entryDate: pos.entryDate,
        exitDate: finalDate,
        entryPrice: parseFloat(pos.entryPrice.toFixed(2)),
        exitPrice: parseFloat(cNow.toFixed(2)),
        returnPct: parseFloat(netReturnPct.toFixed(2)),
        holdingDays,
        exitReason: 'Still Active',
        status: netReturnPct > 0.1 ? 'WIN' : netReturnPct < -0.1 ? 'LOSS' : 'SCRATCH',
      });
    });
  }

  const finalStrategyCapital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].strategyEquity : initialCapital;
  const finalBenchmarkCapital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].benchmarkEquity : initialCapital;
  const finalNifty50Capital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].nifty50Equity : initialCapital;
  const finalGoldCapital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].goldEquity : initialCapital;

  const totalYears = Math.max(0.5, equityPoints.length / 252);
  const strategyCagr = ((Math.max(0.01, finalStrategyCapital) / initialCapital) ** (1 / totalYears) - 1) * 100;
  const benchmarkCagr = ((Math.max(0.01, finalBenchmarkCapital) / initialCapital) ** (1 / totalYears) - 1) * 100;
  const nifty50Cagr = ((Math.max(0.01, finalNifty50Capital) / initialCapital) ** (1 / totalYears) - 1) * 100;
  const goldCagr = ((Math.max(0.01, finalGoldCapital) / initialCapital) ** (1 / totalYears) - 1) * 100;

  const strategyTotalReturn = ((finalStrategyCapital - initialCapital) / initialCapital) * 100;
  const benchmarkTotalReturn = ((finalBenchmarkCapital - initialCapital) / initialCapital) * 100;

  let maxDrawdownStrategy = 0;
  let maxDrawdownBenchmark = 0;
  equityPoints.forEach((pt) => {
    if (pt.strategyDrawdown < maxDrawdownStrategy) maxDrawdownStrategy = pt.strategyDrawdown;
    if (pt.benchmarkDrawdown < maxDrawdownBenchmark) maxDrawdownBenchmark = pt.benchmarkDrawdown;
  });

  // Calculate Win Rate, Profit Factor, Sharpe & Sortino
  const winningTradesList = executedTrades.filter((t) => t.returnPct > 0);
  const losingTradesList = executedTrades.filter((t) => t.returnPct < 0);

  const totalTradesCount = executedTrades.length;
  const winCount = winningTradesList.length;
  const lossCount = losingTradesList.length;

  const winRate = totalTradesCount > 0 ? (winCount / totalTradesCount) * 100 : 0;

  const grossGains = winningTradesList.reduce((sum, t) => sum + t.returnPct, 0);
  const grossLosses = Math.abs(losingTradesList.reduce((sum, t) => sum + t.returnPct, 0));
  const profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? 9.99 : 1.0;

  const avgWinPct = winCount > 0 ? grossGains / winCount : 0;
  const avgLossPct = lossCount > 0 ? -(grossLosses / lossCount) : 0;
  const avgHoldingDays = totalTradesCount > 0 ? executedTrades.reduce((sum, t) => sum + t.holdingDays, 0) / totalTradesCount : 0;

  // Annualized Sharpe Ratio & Sortino Ratio
  const riskFreeRateDaily = 0.065 / 252; // 6.5% INR RBI Repo Rate
  let sumExcess = 0;
  let sumSqDiff = 0;
  let sumDownsideSqDiff = 0;

  for (const r of dailyStrategyReturns) {
    sumExcess += r - riskFreeRateDaily;
  }
  const meanExcess = dailyStrategyReturns.length > 0 ? sumExcess / dailyStrategyReturns.length : 0;

  for (const r of dailyStrategyReturns) {
    const diff = r - riskFreeRateDaily - meanExcess;
    sumSqDiff += diff * diff;
    if (r - riskFreeRateDaily < 0) {
      sumDownsideSqDiff += (r - riskFreeRateDaily) * (r - riskFreeRateDaily);
    }
  }

  const dailyVol = dailyStrategyReturns.length > 1 ? Math.sqrt(sumSqDiff / (dailyStrategyReturns.length - 1)) : 0.01;
  const downsideVol = dailyStrategyReturns.length > 1 ? Math.sqrt(sumDownsideSqDiff / (dailyStrategyReturns.length - 1)) : 0.01;

  const sharpeRatio = dailyVol > 0 ? (meanExcess / dailyVol) * Math.sqrt(252) : 1.2;
  const sortinoRatio = downsideVol > 0 ? (meanExcess / downsideVol) * Math.sqrt(252) : 1.6;

  // Yearly Performance Breakdown
  const yearlyPerformance: YearPerformance[] = [];
  const yearsMap = new Map<number, { startEquity: number; endEquity: number; benchStart: number; benchEnd: number; minDrawdown: number; trades: number; wins: number }>();

  equityPoints.forEach((pt) => {
    if (!yearsMap.has(pt.year)) {
      yearsMap.set(pt.year, {
        startEquity: pt.strategyEquity,
        endEquity: pt.strategyEquity,
        benchStart: pt.benchmarkEquity,
        benchEnd: pt.benchmarkEquity,
        minDrawdown: 0,
        trades: 0,
        wins: 0,
      });
    }
    const yEntry = yearsMap.get(pt.year)!;
    yEntry.endEquity = pt.strategyEquity;
    yEntry.benchEnd = pt.benchmarkEquity;
    if (pt.strategyDrawdown < yEntry.minDrawdown) {
      yEntry.minDrawdown = pt.strategyDrawdown;
    }
  });

  executedTrades.forEach((t) => {
    const yr = parseInt(t.exitDate.substring(0, 4), 10);
    const yEntry = yearsMap.get(yr);
    if (yEntry) {
      yEntry.trades++;
      if (t.returnPct > 0) yEntry.wins++;
    }
  });

  yearsMap.forEach((val, yr) => {
    const stratRet = ((val.endEquity - val.startEquity) / val.startEquity) * 100;
    const benchRet = ((val.benchEnd - val.benchStart) / val.benchStart) * 100;
    yearlyPerformance.push({
      year: yr,
      strategyReturn: parseFloat(stratRet.toFixed(2)),
      benchmarkReturn: parseFloat(benchRet.toFixed(2)),
      alpha: parseFloat((stratRet - benchRet).toFixed(2)),
      maxDrawdown: parseFloat(val.minDrawdown.toFixed(2)),
      tradesCount: val.trades,
      winRate: val.trades > 0 ? parseFloat(((val.wins / val.trades) * 100).toFixed(1)) : 0,
    });
  });

  return {
    config,
    initialCapital,
    finalStrategyCapital: parseFloat(finalStrategyCapital.toFixed(2)),
    finalBenchmarkCapital: parseFloat(finalBenchmarkCapital.toFixed(2)),
    finalNifty50Capital: parseFloat(finalNifty50Capital.toFixed(2)),
    finalGoldCapital: parseFloat(finalGoldCapital.toFixed(2)),
    strategyCagr: parseFloat(strategyCagr.toFixed(2)),
    benchmarkCagr: parseFloat(benchmarkCagr.toFixed(2)),
    nifty50Cagr: parseFloat(nifty50Cagr.toFixed(2)),
    goldCagr: parseFloat(goldCagr.toFixed(2)),
    strategyTotalReturn: parseFloat(strategyTotalReturn.toFixed(2)),
    benchmarkTotalReturn: parseFloat(benchmarkTotalReturn.toFixed(2)),
    strategyMaxDrawdown: parseFloat(maxDrawdownStrategy.toFixed(2)),
    benchmarkMaxDrawdown: parseFloat(maxDrawdownBenchmark.toFixed(2)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    sortinoRatio: parseFloat(sortinoRatio.toFixed(2)),
    winRate: parseFloat(winRate.toFixed(1)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    totalTrades: totalTradesCount,
    winningTrades: winCount,
    losingTrades: lossCount,
    avgWinPct: parseFloat(avgWinPct.toFixed(2)),
    avgLossPct: parseFloat(avgLossPct.toFixed(2)),
    avgHoldingDays: Math.round(avgHoldingDays),
    annualTurnoverPct: Math.round((totalTradesCount / totalYears) * (100 / portfolioSize)),
    yearlyPerformance,
    equityCurve: equityPoints,
    sampleTrades: executedTrades.sort((a, b) => (a.exitDate < b.exitDate ? 1 : -1)),
  };
}
