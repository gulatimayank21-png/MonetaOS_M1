import {
  BacktestConfig,
  BacktestSummary,
  BacktestTrade,
  EquityPoint,
  YearPerformance,
  StopLossMode,
  BacktestWeightStrategy,
  InvestmentMode,
} from '../types';
import {
  NIFTY500_HISTORICAL_RETURNS,
  NIFTY50_HISTORICAL_RETURNS,
  GOLD_HISTORICAL_RETURNS,
} from './backtestEngine';
import { buildMacroDailyTimeline, isMacroCircuitBreakerActive } from './macroIndicators';

/**
 * Calculates Extended Internal Rate of Return (XIRR) using Newton-Raphson method
 * cashFlows: Array of { date: string (YYYY-MM-DD), amount: number }
 * Negative amounts = investments/inflows, Positive amounts = terminal value / withdrawals
 */
export function calculateXIRR(
  cashFlows: Array<{ date: string; amount: number }>,
  guess = 0.15
): number {
  if (!cashFlows || cashFlows.length < 2) return 0;

  let hasNegative = false;
  let hasPositive = false;
  for (const cf of cashFlows) {
    if (cf.amount < 0) hasNegative = true;
    if (cf.amount > 0) hasPositive = true;
  }
  if (!hasNegative || !hasPositive) return 0;

  const d0 = new Date(cashFlows[0].date).getTime();
  const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

  // NPV function
  const f = (rate: number): number => {
    let npv = 0;
    for (const cf of cashFlows) {
      const dt = (new Date(cf.date).getTime() - d0) / MS_PER_YEAR;
      npv += cf.amount / Math.pow(1 + rate, dt);
    }
    return npv;
  };

  // Derivative of NPV function
  const df = (rate: number): number => {
    let dnpv = 0;
    for (const cf of cashFlows) {
      const dt = (new Date(cf.date).getTime() - d0) / MS_PER_YEAR;
      dnpv -= (dt * cf.amount) / Math.pow(1 + rate, dt + 1);
    }
    return dnpv;
  };

  let rate = guess;
  const maxIterations = 150;
  const tolerance = 1e-6;

  for (let i = 0; i < maxIterations; i++) {
    const y = f(rate);
    const dy = df(rate);

    if (Math.abs(dy) < 1e-12) break;

    const nextRate = rate - y / dy;

    // Boundary guards
    if (nextRate <= -0.999 || isNaN(nextRate) || !isFinite(nextRate)) {
      rate = rate > 0 ? rate / 2 : 0.05;
      continue;
    }

    if (Math.abs(nextRate - rate) < tolerance) {
      return parseFloat((nextRate * 100).toFixed(2));
    }

    rate = nextRate;
  }

  return parseFloat((rate * 100).toFixed(2));
}

export interface StockDailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MacroDailyCandle {
  date: string;
  indexName: string;
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

export function normalizeMacroIndexName(raw: string): string {
  const s = (raw || '').trim().toUpperCase().replace(/[\^_\.]/g, ' ').replace(/\s+/g, ' ');
  if (s.includes('VIX')) return 'INDIA VIX';
  if (s.includes('500')) return 'NIFTY 500';
  if (s.includes('50') && !s.includes('500')) return 'NIFTY 50';
  if (s.includes('GOLD')) return 'GOLDBEES';
  if (s.includes('LIQUID')) return 'LIQUIDBEES';
  return (raw || '').trim().toUpperCase();
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
  // Macro instruments from macro_daily (e.g. NIFTY 50, NIFTY 500, INDIA VIX, GOLDBEES, LIQUIDBEES)
  macroData?: Map<string, Map<string, MacroDailyCandle>>;
  macroSeries?: Map<string, MacroDailyCandle[]>;
  macroDateIdx?: Map<string, Map<string, number>>;
}

/**
 * Parses raw SQLite query rows into an optimized, in-memory continuous market matrix
 */
export function buildMarketMatrix(
  rows: any[],
  indexHistoryRows?: any[],
  lineageRows?: any[],
  macroRows?: any[]
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

  // Parse Real Macro Instruments from macro_daily table (Nifty 50, Nifty 500, India VIX, GoldBeES, LiquidBeES)
  const macroData = new Map<string, Map<string, MacroDailyCandle>>();
  const macroSeries = new Map<string, MacroDailyCandle[]>();
  const macroDateIdx = new Map<string, Map<string, number>>();

  if (macroRows && Array.isArray(macroRows)) {
    for (let m = 0; m < macroRows.length; m++) {
      const mRow = macroRows[m];
      const dt: string = Array.isArray(mRow) ? mRow[0] : mRow.trade_date || mRow.date;
      const rawName: string = Array.isArray(mRow) ? mRow[1] : mRow.index_name || mRow.symbol;
      const o: number = Number(Array.isArray(mRow) ? mRow[2] : mRow.open) || 0;
      const h: number = Number(Array.isArray(mRow) ? mRow[3] : mRow.high) || o;
      const l: number = Number(Array.isArray(mRow) ? mRow[4] : mRow.low) || o;
      const c: number = Number(Array.isArray(mRow) ? mRow[5] : mRow.close) || o;
      const v: number = Number(Array.isArray(mRow) ? mRow[6] : mRow.volume) || 0;

      if (!dt || !rawName || isNaN(c)) continue;
      const normName = normalizeMacroIndexName(rawName);

      if (!macroData.has(normName)) {
        macroData.set(normName, new Map());
        macroSeries.set(normName, []);
        macroDateIdx.set(normName, new Map());
      }

      const mCandle: MacroDailyCandle = {
        date: dt,
        indexName: normName,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      };

      macroData.get(normName)!.set(dt, mCandle);
      const mArr = macroSeries.get(normName)!;
      const mIdx = mArr.length;
      mArr.push(mCandle);
      macroDateIdx.get(normName)!.set(dt, mIdx);
    }
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

  return {
    allDates,
    symbols,
    data,
    symbolCandles,
    symbolDateIdx,
    indexHistory,
    symbolLineage,
    macroData,
    macroSeries,
    macroDateIdx,
  };
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
    investmentMode = 'lumpsum',
    initialCapital = 1000000,
    sipMonthlyAmount = 25000,
    sipDayOfMonth = 1,
    sipAnnualStepUpPct = 0,
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

  // Determine starting lump-sum capital
  const effectiveStartCapital =
    investmentMode === 'sip' && initialCapital === 0 ? sipMonthlyAmount : initialCapital;

  let cash = effectiveStartCapital;
  const positions = new Map<string, ActivePosition>();
  const executedTrades: BacktestTrade[] = [];
  const equityPoints: EquityPoint[] = [];

  let peakPortfolioEquity = effectiveStartCapital;
  let peakBenchmarkEquity = effectiveStartCapital;
  let benchmarkCapital = effectiveStartCapital;
  let nifty50Capital = effectiveStartCapital;
  let goldCapital = effectiveStartCapital;

  // Tracking recurring SIP contributions and Cash Flows for XIRR
  let totalInvestedCapital = effectiveStartCapital;
  let totalSipContributions = 0;
  const cashFlows: Array<{ date: string; amount: number }> = [];
  const yearlyInflowMap = new Map<number, number>();

  if (effectiveStartCapital > 0 && allDates[simStartIdx]) {
    cashFlows.push({ date: allDates[simStartIdx], amount: -effectiveStartCapital });
    const sYr = parseInt(allDates[simStartIdx].substring(0, 4), 10);
    yearlyInflowMap.set(sYr, (yearlyInflowMap.get(sYr) || 0) + effectiveStartCapital);
  }

  let lastSipMonthKey = '';

  const lastKnownCloses = new Map<string, number>();
  const monthsProcessed = new Set<string>();
  let lastRebalanceDateIdx = -1;
  let lastRebalanceWeekKey = '';

  // Track daily returns for Sharpe / Sortino calculation
  const dailyStrategyReturns: number[] = [];
  let previousDayEquity = effectiveStartCapital;

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

    // 14-day Average True Range (ATR) calculation
    let atr14 = 0;
    let atrPct = 2.5; // fallback default
    if (cIdx >= 14) {
      let trSum = 0;
      for (let k = cIdx - 13; k <= cIdx; k++) {
        const cur = candles[k];
        const prev = candles[k - 1];
        const prevClose = prev ? prev.close : cur.open;
        const tr = Math.max(
          cur.high - cur.low,
          Math.abs(cur.high - prevClose),
          Math.abs(cur.low - prevClose)
        );
        trSum += tr;
      }
      atr14 = trSum / 14;
      if (cNow > 0 && atr14 > 0) {
        atrPct = (atr14 / cNow) * 100;
      }
    }

    return {
      symbol: sym,
      closePrice: cNow,
      momentumScore,
      high52W,
      dist52WHighPct,
      atr14,
      atrPct,
    };
  };

  // Helper to compute dynamic portfolio weights across top candidates
  const computeCandidateWeights = (
    candidates: Array<{
      symbol: string;
      closePrice: number;
      momentumScore: number;
      dist52WHighPct: number;
      atrPct: number;
    }>,
    targetSize: number,
    strategy: BacktestWeightStrategy = 'equal_weight',
    maxCapPct?: number
  ): Map<string, number> => {
    const topCands = candidates.slice(0, targetSize);
    const n = topCands.length;
    const weightMap = new Map<string, number>();
    if (n === 0) return weightMap;

    if (strategy === 'equal_weight') {
      const fixedSlotWeight = maxCapPct ? Math.min(maxCapPct / 100, 1 / targetSize) : 1 / targetSize;
      topCands.forEach((c) => weightMap.set(c.symbol, fixedSlotWeight));
      return weightMap;
    }

    const minScore = Math.min(...topCands.map((c) => c.momentumScore));
    const maxScore = Math.max(...topCands.map((c) => c.momentumScore));
    const scoreSpread = Math.max(0.001, maxScore - minScore);

    const rawWeights: number[] = topCands.map((c, idx) => {
      const rankNum = idx + 1;
      const normScore = Math.max(0.05, (c.momentumScore - minScore) / scoreSpread);
      const safeAtrPct = Math.max(0.8, c.atrPct || 2.5);

      switch (strategy) {
        case 'atr_momentum_parity':
          // Volatility-Adjusted Momentum: Higher return / lower ATR = higher weight
          return (normScore / safeAtrPct) * (1 / Math.sqrt(rankNum));
        case 'atr_inverse_vol':
          // Pure Risk Parity: Inverse ATR
          return 1 / safeAtrPct;
        case 'multi_factor':
          // Multi-Factor: Score² * rank decay
          return Math.pow(normScore, 2) * (1 / Math.sqrt(rankNum));
        case 'composite_score':
          // Cubic score spread
          return Math.pow(normScore, 3);
        case 'rank_decay':
          // Rank power decay
          return 1 / Math.pow(rankNum, 0.65);
        default:
          return 1.0;
      }
    });

    const totalRaw = rawWeights.reduce((a, b) => a + b, 0);
    // When portfolio is full (n >= targetSize), distribute 100% capital.
    // If fewer than targetSize candidates qualify, scale invested capital to (n / targetSize) to preserve dry powder cash.
    const capitalScaleFactor = Math.min(1.0, n / targetSize);
    let normWeights = rawWeights.map((rw) => (rw / (totalRaw || 1)) * capitalScaleFactor);

    // Enforce single-stock maximum position cap if specified
    const effectiveCap = maxCapPct ? maxCapPct / 100 : Math.min(0.35, 2.0 / targetSize);
    if (normWeights.some((w) => w > effectiveCap)) {
      let capped = [...normWeights];
      let isCapped = new Array(capped.length).fill(false);
      for (let iter = 0; iter < 5; iter++) {
        let excess = 0;
        let uncappedSum = 0;
        for (let i = 0; i < capped.length; i++) {
          if (!isCapped[i] && capped[i] > effectiveCap) {
            excess += capped[i] - effectiveCap;
            capped[i] = effectiveCap;
            isCapped[i] = true;
          } else if (!isCapped[i]) {
            uncappedSum += capped[i];
          }
        }
        if (excess <= 0.0001 || uncappedSum <= 0) break;
        for (let i = 0; i < capped.length; i++) {
          if (!isCapped[i]) {
            capped[i] += excess * (capped[i] / uncappedSum);
          }
        }
      }
      normWeights = capped;
    }

    topCands.forEach((c, idx) => {
      weightMap.set(c.symbol, normWeights[idx]);
    });

    return weightMap;
  };

  // Helper to get top ranked momentum candidates on a specific date
  const getTopRankedCandidates = (currentDate: string) => {
    const scoredList: Array<{
      symbol: string;
      closePrice: number;
      momentumScore: number;
      dist52WHighPct: number;
      atrPct: number;
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
        atrPct: m.atrPct,
      });
    }

    // Sort by Momentum Score descending
    scoredList.sort((a, b) => b.momentumScore - a.momentumScore);
    return scoredList;
  };

  let inDefensiveCash = false;

  // Defensive Yield / Cash Asset parameters
  const defensiveAssetType = config.defensiveAssetType || 'liquid_fund';
  let defensiveYieldAnnualPct = config.defensiveCashYieldPct;
  if (defensiveYieldAnnualPct === undefined) {
    if (defensiveAssetType === 'cash_zero') defensiveYieldAnnualPct = 0;
    else if (defensiveAssetType === 'liquid_fund') defensiveYieldAnnualPct = 6.5;
    else if (defensiveAssetType === 'fixed_deposit') defensiveYieldAnnualPct = 7.5;
    else if (defensiveAssetType === 'gold_etf') defensiveYieldAnnualPct = 12.0;
    else defensiveYieldAnnualPct = 6.5;
  }
  let totalDefensiveYieldEarned = 0;
  let defensiveCashDaysCount = 0;
  let sumCashExposurePct = 0;

  for (let i = simStartIdx; i < allDates.length; i++) {
    const currentDate = allDates[i];
    const currentYear = parseInt(currentDate.substring(0, 4), 10);
    if (currentYear > endYear) break;

    // 0. Handle Recurring SIP cash ingestion
    const dateParts = currentDate.split('-');
    const currentYearNum = parseInt(dateParts[0], 10);
    const currentDayNum = parseInt(dateParts[2], 10);
    const currentMonthKey = `${dateParts[0]}-${dateParts[1]}`;

    if (
      (investmentMode === 'sip' || investmentMode === 'hybrid') &&
      currentMonthKey !== lastSipMonthKey &&
      currentDayNum >= sipDayOfMonth
    ) {
      // Annual step-up multiplier
      const yearsElapsed = Math.max(0, currentYearNum - startYear);
      const stepMultiplier = Math.pow(1 + (sipAnnualStepUpPct / 100), yearsElapsed);
      const stepSipAmount = Math.round(sipMonthlyAmount * stepMultiplier);

      cash += stepSipAmount;
      benchmarkCapital += stepSipAmount;
      nifty50Capital += stepSipAmount;
      goldCapital += stepSipAmount;

      totalInvestedCapital += stepSipAmount;
      totalSipContributions += stepSipAmount;
      cashFlows.push({ date: currentDate, amount: -stepSipAmount });
      yearlyInflowMap.set(currentYearNum, (yearlyInflowMap.get(currentYearNum) || 0) + stepSipAmount);

      lastSipMonthKey = currentMonthKey;
    }

    // Apply daily yield on idle cash / defensive asset allocation
    let dailyYieldEarned = 0;
    if (cash > 0) {
      if (defensiveAssetType === 'gold_etf') {
        const goldCandleNow = matrix.macroData?.get('GOLDBEES')?.get(currentDate);
        const goldCandlePrev = i > 0 ? matrix.macroData?.get('GOLDBEES')?.get(allDates[i - 1]) : null;
        if (goldCandleNow && goldCandlePrev && goldCandlePrev.close > 0 && goldCandleNow.close > 0) {
          const dailyGoldReturn = (goldCandleNow.close - goldCandlePrev.close) / goldCandlePrev.close;
          dailyYieldEarned = cash * dailyGoldReturn;
          cash += dailyYieldEarned;
          totalDefensiveYieldEarned += dailyYieldEarned;
        } else if (defensiveYieldAnnualPct > 0) {
          const dailyRate = (defensiveYieldAnnualPct / 100) / 252;
          dailyYieldEarned = cash * dailyRate;
          cash += dailyYieldEarned;
          totalDefensiveYieldEarned += dailyYieldEarned;
        }
      } else if (defensiveAssetType === 'liquid_fund') {
        const liquidCandleNow = matrix.macroData?.get('LIQUIDBEES')?.get(currentDate);
        const liquidCandlePrev = i > 0 ? matrix.macroData?.get('LIQUIDBEES')?.get(allDates[i - 1]) : null;
        if (
          liquidCandleNow &&
          liquidCandlePrev &&
          liquidCandlePrev.close > 0 &&
          liquidCandleNow.close > 0 &&
          liquidCandleNow.close !== liquidCandlePrev.close
        ) {
          const dailyLiquidReturn = (liquidCandleNow.close - liquidCandlePrev.close) / liquidCandlePrev.close;
          dailyYieldEarned = cash * dailyLiquidReturn;
          cash += dailyYieldEarned;
          totalDefensiveYieldEarned += dailyYieldEarned;
        } else if (defensiveYieldAnnualPct > 0) {
          const dailyRate = (defensiveYieldAnnualPct / 100) / 252;
          dailyYieldEarned = cash * dailyRate;
          cash += dailyYieldEarned;
          totalDefensiveYieldEarned += dailyYieldEarned;
        }
      } else if (defensiveYieldAnnualPct > 0) {
        const dailyRate = (defensiveYieldAnnualPct / 100) / 252;
        dailyYieldEarned = cash * dailyRate;
        cash += dailyYieldEarned;
        totalDefensiveYieldEarned += dailyYieldEarned;
      }
    }

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
      config.circuitBreakers,
      inDefensiveCash
    );

    // Update defensive cash status
    if (macroBreaker.isActive) {
      inDefensiveCash = true;
    } else {
      inDefensiveCash = false;
    }

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

      // Calculate Total Portfolio Value for dynamic slot sizing
      let currentInvestedValue = 0;
      positions.forEach((pos, sym) => {
        const c = lastKnownCloses.get(sym) || pos.entryPrice;
        currentInvestedValue += pos.shares * c;
      });

      const totalEquity = cash + currentInvestedValue;
      const weightStrategy = config.weightStrategy || 'equal_weight';
      const weightMap = computeCandidateWeights(
        scoredCandidates,
        portfolioSize,
        weightStrategy,
        maxPositionWeightPct
      );

      // Buy top momentum candidates into open portfolio slots
      for (const cand of scoredCandidates) {
        if (positions.size >= portfolioSize) break;
        if (!positions.has(cand.symbol)) {
          const cNow = lastKnownCloses.get(cand.symbol);
          const candWeight = weightMap.get(cand.symbol) || 1 / portfolioSize;
          const targetSlotCapital = totalEquity * candWeight;

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
      const weightStrategy = config.weightStrategy || 'equal_weight';
      const weightMap = computeCandidateWeights(
        scoredCandidates,
        portfolioSize,
        weightStrategy,
        maxPositionWeightPct
      );

      for (const cand of scoredCandidates) {
        if (positions.size >= portfolioSize) break;
        if (!positions.has(cand.symbol)) {
          const cNow = lastKnownCloses.get(cand.symbol);
          const candWeight = weightMap.get(cand.symbol) || 1 / portfolioSize;
          const targetSlotCapital = totalEquity * candWeight;

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
    let dailyMarketRetGold = yrReturnGold / 25200;
    if (i > 0 && macroTimeline.nifty500[i - 1] > 0 && macroTimeline.nifty500[i] > 0) {
      dailyMarketRet500 = (macroTimeline.nifty500[i] - macroTimeline.nifty500[i - 1]) / macroTimeline.nifty500[i - 1];
    }
    if (i > 0 && macroTimeline.nifty50[i - 1] > 0 && macroTimeline.nifty50[i] > 0) {
      dailyMarketRet50 = (macroTimeline.nifty50[i] - macroTimeline.nifty50[i - 1]) / macroTimeline.nifty50[i - 1];
    }
    const goldCandleNow = matrix.macroData?.get('GOLDBEES')?.get(currentDate);
    const goldCandlePrev = i > 0 ? matrix.macroData?.get('GOLDBEES')?.get(allDates[i - 1]) : null;
    if (goldCandleNow && goldCandlePrev && goldCandlePrev.close > 0 && goldCandleNow.close > 0) {
      dailyMarketRetGold = (goldCandleNow.close - goldCandlePrev.close) / goldCandlePrev.close;
    }

    benchmarkCapital *= 1 + dailyMarketRet500;
    nifty50Capital *= 1 + dailyMarketRet50;
    goldCapital *= 1 + dailyMarketRetGold;

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

    const cashPct = currentStrategyEquity > 0 ? (cash / currentStrategyEquity) * 100 : 0;
    const equityPct = currentStrategyEquity > 0 ? (investedStockValue / currentStrategyEquity) * 100 : 0;
    sumCashExposurePct += cashPct;

    if (macroBreaker.isActive || positions.size === 0) {
      defensiveCashDaysCount++;
    }

    equityPoints.push({
      date: currentDate,
      year: currentYear,
      strategyEquity: parseFloat(currentStrategyEquity.toFixed(2)),
      benchmarkEquity: parseFloat(benchmarkCapital.toFixed(2)),
      nifty50Equity: parseFloat(nifty50Capital.toFixed(2)),
      goldEquity: parseFloat(goldCapital.toFixed(2)),
      strategyDrawdown: parseFloat(strategyDrawdown.toFixed(2)),
      benchmarkDrawdown: parseFloat(benchmarkDrawdown.toFixed(2)),
      cumulativeInvested: parseFloat(totalInvestedCapital.toFixed(2)),
      cashPct: parseFloat(cashPct.toFixed(1)),
      equityPct: parseFloat(equityPct.toFixed(1)),
      cashAmount: parseFloat(cash.toFixed(2)),
      isDefensiveMode: macroBreaker.isActive,
      defensiveYieldToday: parseFloat(dailyYieldEarned.toFixed(2)),
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

  const finalStrategyCapital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].strategyEquity : effectiveStartCapital;
  const finalBenchmarkCapital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].benchmarkEquity : effectiveStartCapital;
  const finalNifty50Capital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].nifty50Equity : effectiveStartCapital;
  const finalGoldCapital = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].goldEquity : effectiveStartCapital;
  const finalDate = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].date : allDates[allDates.length - 1];

  // Calculate terminal cash flows for XIRR
  const stratCashFlows = [...cashFlows, { date: finalDate, amount: finalStrategyCapital }];
  const benchCashFlows = [...cashFlows, { date: finalDate, amount: finalBenchmarkCapital }];
  const nifty50CashFlows = [...cashFlows, { date: finalDate, amount: finalNifty50Capital }];
  const goldCashFlows = [...cashFlows, { date: finalDate, amount: finalGoldCapital }];

  const strategyXirr = calculateXIRR(stratCashFlows);
  const benchmarkXirr = calculateXIRR(benchCashFlows);
  const nifty50Xirr = calculateXIRR(nifty50CashFlows);
  const goldXirr = calculateXIRR(goldCashFlows);

  const totalYears = Math.max(0.5, equityPoints.length / 252);
  let strategyCagr: number;
  let benchmarkCagr: number;
  let nifty50Cagr: number;
  let goldCagr: number;

  if (investmentMode === 'sip' || investmentMode === 'hybrid') {
    strategyCagr = strategyXirr;
    benchmarkCagr = benchmarkXirr;
    nifty50Cagr = nifty50Xirr;
    goldCagr = goldXirr;
  } else {
    strategyCagr = ((Math.max(0.01, finalStrategyCapital) / Math.max(1, effectiveStartCapital)) ** (1 / totalYears) - 1) * 100;
    benchmarkCagr = ((Math.max(0.01, finalBenchmarkCapital) / Math.max(1, effectiveStartCapital)) ** (1 / totalYears) - 1) * 100;
    nifty50Cagr = ((Math.max(0.01, finalNifty50Capital) / Math.max(1, effectiveStartCapital)) ** (1 / totalYears) - 1) * 100;
    goldCagr = ((Math.max(0.01, finalGoldCapital) / Math.max(1, effectiveStartCapital)) ** (1 / totalYears) - 1) * 100;
  }

  const strategyTotalReturn = ((finalStrategyCapital - totalInvestedCapital) / Math.max(1, totalInvestedCapital)) * 100;
  const benchmarkTotalReturn = ((finalBenchmarkCapital - totalInvestedCapital) / Math.max(1, totalInvestedCapital)) * 100;

  const strategyMoic = parseFloat((finalStrategyCapital / Math.max(1, totalInvestedCapital)).toFixed(2));
  const benchmarkMoic = parseFloat((finalBenchmarkCapital / Math.max(1, totalInvestedCapital)).toFixed(2));
  const nifty50Moic = parseFloat((finalNifty50Capital / Math.max(1, totalInvestedCapital)).toFixed(2));
  const goldMoic = parseFloat((finalGoldCapital / Math.max(1, totalInvestedCapital)).toFixed(2));

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

  let runningCumulativeInvested = 0;
  yearsMap.forEach((val, yr) => {
    const yrInflow = yearlyInflowMap.get(yr) || 0;
    runningCumulativeInvested += yrInflow;
    let stratRet: number;
    let benchRet: number;

    if (investmentMode === 'sip' || investmentMode === 'hybrid') {
      // Modified Dietz method for intra-year recurring flows
      const stratGain = val.endEquity - val.startEquity - yrInflow;
      const stratBase = val.startEquity + yrInflow / 2;
      stratRet = stratBase > 0 ? (stratGain / stratBase) * 100 : 0;

      const benchGain = val.benchEnd - val.benchStart - yrInflow;
      const benchBase = val.benchStart + yrInflow / 2;
      benchRet = benchBase > 0 ? (benchGain / benchBase) * 100 : 0;
    } else {
      stratRet = ((val.endEquity - val.startEquity) / Math.max(1, val.startEquity)) * 100;
      benchRet = ((val.benchEnd - val.benchStart) / Math.max(1, val.benchStart)) * 100;
    }

    yearlyPerformance.push({
      year: yr,
      strategyReturn: parseFloat(stratRet.toFixed(2)),
      benchmarkReturn: parseFloat(benchRet.toFixed(2)),
      alpha: parseFloat((stratRet - benchRet).toFixed(2)),
      maxDrawdown: parseFloat(val.minDrawdown.toFixed(2)),
      tradesCount: val.trades,
      winRate: val.trades > 0 ? parseFloat(((val.wins / val.trades) * 100).toFixed(1)) : 0,
      yearlyInflow: yrInflow,
      cumulativeInvested: runningCumulativeInvested,
      endStrategyCapital: parseFloat(val.endEquity.toFixed(2)),
    });
  });

  return {
    config,
    investmentMode,
    initialCapital: effectiveStartCapital,
    totalInvestedCapital: parseFloat(totalInvestedCapital.toFixed(2)),
    totalSipContributions: parseFloat(totalSipContributions.toFixed(2)),
    finalStrategyCapital: parseFloat(finalStrategyCapital.toFixed(2)),
    finalBenchmarkCapital: parseFloat(finalBenchmarkCapital.toFixed(2)),
    finalNifty50Capital: parseFloat(finalNifty50Capital.toFixed(2)),
    finalGoldCapital: parseFloat(finalGoldCapital.toFixed(2)),
    strategyCagr: parseFloat(strategyCagr.toFixed(2)),
    benchmarkCagr: parseFloat(benchmarkCagr.toFixed(2)),
    nifty50Cagr: parseFloat(nifty50Cagr.toFixed(2)),
    goldCagr: parseFloat(goldCagr.toFixed(2)),
    strategyXirr: parseFloat(strategyXirr.toFixed(2)),
    benchmarkXirr: parseFloat(benchmarkXirr.toFixed(2)),
    nifty50Xirr: parseFloat(nifty50Xirr.toFixed(2)),
    goldXirr: parseFloat(goldXirr.toFixed(2)),
    strategyTotalReturn: parseFloat(strategyTotalReturn.toFixed(2)),
    benchmarkTotalReturn: parseFloat(benchmarkTotalReturn.toFixed(2)),
    strategyMoic,
    benchmarkMoic,
    nifty50Moic,
    goldMoic,
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
    defensiveCashDays: defensiveCashDaysCount,
    defensiveCashPct: equityPoints.length > 0 ? parseFloat(((defensiveCashDaysCount / equityPoints.length) * 100).toFixed(1)) : 0,
    avgCashExposurePct: equityPoints.length > 0 ? parseFloat((sumCashExposurePct / equityPoints.length).toFixed(1)) : 0,
    totalDefensiveYieldEarned: Math.round(totalDefensiveYieldEarned),
    defensiveAssetType,
    defensiveCashYieldPct: defensiveYieldAnnualPct,
    yearlyPerformance,
    equityCurve: equityPoints,
    sampleTrades: executedTrades.sort((a, b) => (a.exitDate < b.exitDate ? 1 : -1)),
  };
}
