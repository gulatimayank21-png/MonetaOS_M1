import { InMemMarketMatrix } from './realDataBacktestEngine';
import { MacroRegimeFilter, CircuitBreakersConfig } from '../types';

export const NIFTY_50_TICKERS = new Set([
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'ITC', 'SBIN', 'LICI',
  'HINDUNILVR', 'LT', 'BAJFINANCE', 'HCLTECH', 'MARUTI', 'SUNPHARMA', 'ADANIENT', 'KOTAKBANK',
  'TITAN', 'ONGC', 'TATAMOTORS', 'NTPC', 'AXISBANK', 'ADANIPORTS', 'POWERGRID', 'COALINDIA',
  'M&M', 'BAJAJFINSV', 'ULTRACEMCO', 'ASIANPAINT', 'NESTLEIND', 'JSWSTEEL', 'TATASTEEL',
  'GRASIM', 'TECHM', 'WIPRO', 'CIPLA', 'HINDALCO', 'SBILIFE', 'DRREDDY', 'BRITANNIA',
  'HDFCLIFE', 'EICHERMOT', 'APOLLOHOSP', 'DIVISLAB', 'BAJAJ-AUTO', 'HEROMOTOCO', 'INDUSINDBK',
  'BPCL', 'TATACONSUM', 'SHRIRAMFIN', 'TRENT', 'BEL'
]);

export interface MacroDailyTimeline {
  dates: string[];
  nifty50: number[];
  nifty50_200dma: number[];
  nifty50_200ema: number[];
  nifty50_50dma: number[];
  nifty50_50ema: number[];
  nifty500: number[];
  nifty500_200dma: number[];
  nifty500_200ema: number[];
  nifty500_100ema: number[];
  nifty500_50dma: number[];
  nifty500_50ema: number[];
  indiaVix: number[];
  // Market Breadth Indicators (% of Nifty 500 stocks trading above MAs)
  breadthPctAbove50Ema: number[];
  breadthPctAbove50Dma: number[];
  breadthPctAbove200Dma: number[];
  // Rapid market drawdown: % drop from 20-day rolling high
  nifty500_20d_dropPct: number[];
}

/**
 * Historical VIX event anchor spikes for India VIX calibration across 2015-2026.
 */
const VIX_ANCHORS: Array<{ startDate: string; endDate: string; peakVix: number; baseVix: number }> = [
  { startDate: '2015-08-15', endDate: '2015-09-30', peakVix: 28.5, baseVix: 17 }, // China devaluation
  { startDate: '2016-11-08', endDate: '2016-12-15', peakVix: 22.8, baseVix: 15 }, // Demonetization / Trump election
  { startDate: '2018-01-25', endDate: '2018-03-31', peakVix: 21.5, baseVix: 14 }, // Global Volmageddon / LTCG reintroduction
  { startDate: '2018-09-01', endDate: '2018-11-20', peakVix: 23.5, baseVix: 16 }, // IL&FS NBFC liquidity crisis
  { startDate: '2019-05-01', endDate: '2019-05-24', peakVix: 29.8, baseVix: 18 }, // General Elections 2019
  { startDate: '2020-02-20', endDate: '2020-05-30', peakVix: 86.6, baseVix: 28 }, // COVID-19 Crash
  { startDate: '2020-06-01', endDate: '2020-11-30', peakVix: 24.5, baseVix: 20 }, // Post-COVID recovery elevated volatility
  { startDate: '2021-02-01', endDate: '2021-05-31', peakVix: 25.2, baseVix: 19 }, // Delta wave in India
  { startDate: '2022-01-15', endDate: '2022-04-15', peakVix: 33.9, baseVix: 22 }, // Russia-Ukraine war & Fed rate hike cycle
  { startDate: '2022-05-01', endDate: '2022-07-31', peakVix: 23.5, baseVix: 18 }, // Inflation peak
  { startDate: '2023-01-24', endDate: '2023-03-15', peakVix: 18.2, baseVix: 13.5 }, // Adani-Hindenburg episode
  { startDate: '2024-05-01', endDate: '2024-06-15', peakVix: 31.7, baseVix: 19 }, // General Elections 2024
  { startDate: '2024-08-01', endDate: '2024-08-15', peakVix: 22.0, baseVix: 14.5 }, // Yen Carry Trade unwind
  { startDate: '2025-01-01', endDate: '2026-12-31', peakVix: 17.5, baseVix: 13.5 }, // Steady state
];

/**
 * Calculates synthetic Nifty 50, Nifty 500, moving averages, Breadth metrics, and India VIX across the matrix dates.
 */
export function buildMacroDailyTimeline(matrix: InMemMarketMatrix): MacroDailyTimeline {
  const { allDates, symbols, data, symbolCandles, symbolDateIdx } = matrix;
  const len = allDates.length;

  const nifty50: number[] = new Array(len).fill(0);
  const nifty500: number[] = new Array(len).fill(0);
  const nifty50_200dma: number[] = new Array(len).fill(0);
  const nifty50_200ema: number[] = new Array(len).fill(0);
  const nifty50_50dma: number[] = new Array(len).fill(0);
  const nifty50_50ema: number[] = new Array(len).fill(0);
  const nifty500_200dma: number[] = new Array(len).fill(0);
  const nifty500_200ema: number[] = new Array(len).fill(0);
  const nifty500_100ema: number[] = new Array(len).fill(0);
  const nifty500_50dma: number[] = new Array(len).fill(0);
  const nifty500_50ema: number[] = new Array(len).fill(0);
  const indiaVix: number[] = new Array(len).fill(14);
  const breadthPctAbove50Ema: number[] = new Array(len).fill(50);
  const breadthPctAbove50Dma: number[] = new Array(len).fill(50);
  const breadthPctAbove200Dma: number[] = new Array(len).fill(50);
  const nifty500_20d_dropPct: number[] = new Array(len).fill(0);

  let prevNifty50 = 8000;
  let prevNifty500 = 6500;

  // 1. Synthesize daily index levels based on breadth & weighted price action
  for (let i = 0; i < len; i++) {
    const d = allDates[i];
    let sum50 = 0;
    let count50 = 0;
    let sum500 = 0;
    let count500 = 0;

    for (let s = 0; s < symbols.length; s++) {
      const sym = symbols[s];
      const candle = data.get(sym)?.get(d);
      if (candle && candle.close > 0) {
        sum500 += candle.close;
        count500++;
        if (NIFTY_50_TICKERS.has(sym)) {
          sum50 += candle.close;
          count50++;
        }
      }
    }

    if (i === 0) {
      nifty50[i] = 8200;
      nifty500[i] = 6800;
    } else {
      // Calculate daily index returns
      const prevDate = allDates[i - 1];
      let ret50Sum = 0;
      let ret50Count = 0;
      let ret500Sum = 0;
      let ret500Count = 0;

      for (let s = 0; s < symbols.length; s++) {
        const sym = symbols[s];
        const candleNow = data.get(sym)?.get(d);
        const candlePrev = data.get(sym)?.get(prevDate);
        if (candleNow && candlePrev && candleNow.close > 0 && candlePrev.close > 0) {
          const r = (candleNow.close - candlePrev.close) / candlePrev.close;
          ret500Sum += r;
          ret500Count++;
          if (NIFTY_50_TICKERS.has(sym)) {
            ret50Sum += r;
            ret50Count++;
          }
        }
      }

      const dailyRet50 = ret50Count > 0 ? ret50Sum / ret50Count : 0.0004;
      const dailyRet500 = ret500Count > 0 ? ret500Sum / ret500Count : 0.0005;

      nifty50[i] = prevNifty50 * (1 + dailyRet50);
      nifty500[i] = prevNifty500 * (1 + dailyRet500);
    }

    prevNifty50 = nifty50[i];
    prevNifty500 = nifty500[i];
  }

  // 2. Compute 200 DMA, 200 EMA, 100 EMA, 50 DMA, 50 EMA for Benchmarks
  const ema200Multiplier = 2 / (200 + 1);
  const ema100Multiplier = 2 / (100 + 1);
  const ema50Multiplier = 2 / (50 + 1);

  let ema50_200 = nifty50[0];
  let ema50_50 = nifty50[0];
  let ema500_200 = nifty500[0];
  let ema500_100 = nifty500[0];
  let ema500_50 = nifty500[0];

  for (let i = 0; i < len; i++) {
    // 200 DMA & 50 DMA
    const windowStart200 = Math.max(0, i - 199);
    const windowCount200 = i - windowStart200 + 1;
    let sumDma50_200 = 0;
    let sumDma500_200 = 0;

    for (let k = windowStart200; k <= i; k++) {
      sumDma50_200 += nifty50[k];
      sumDma500_200 += nifty500[k];
    }
    nifty50_200dma[i] = sumDma50_200 / windowCount200;
    nifty500_200dma[i] = sumDma500_200 / windowCount200;

    const windowStart50 = Math.max(0, i - 49);
    const windowCount50 = i - windowStart50 + 1;
    let sumDma50_50 = 0;
    let sumDma500_50 = 0;
    for (let k = windowStart50; k <= i; k++) {
      sumDma50_50 += nifty50[k];
      sumDma500_50 += nifty500[k];
    }
    nifty50_50dma[i] = sumDma50_50 / windowCount50;
    nifty500_50dma[i] = sumDma500_50 / windowCount50;

    // EMAs
    if (i === 0) {
      ema50_200 = nifty50[0];
      ema50_50 = nifty50[0];
      ema500_200 = nifty500[0];
      ema500_100 = nifty500[0];
      ema500_50 = nifty500[0];
    } else {
      ema50_200 = (nifty50[i] - ema50_200) * ema200Multiplier + ema50_200;
      ema50_50 = (nifty50[i] - ema50_50) * ema50Multiplier + ema50_50;
      ema500_200 = (nifty500[i] - ema500_200) * ema200Multiplier + ema500_200;
      ema500_100 = (nifty500[i] - ema500_100) * ema100Multiplier + ema500_100;
      ema500_50 = (nifty500[i] - ema500_50) * ema50Multiplier + ema500_50;
    }
    nifty50_200ema[i] = ema50_200;
    nifty50_50ema[i] = ema50_50;
    nifty500_200ema[i] = ema500_200;
    nifty500_100ema[i] = ema500_100;
    nifty500_50ema[i] = ema500_50;

    // 20-day high drop for Nifty 500
    const start20 = Math.max(0, i - 19);
    let peak20 = nifty500[start20];
    for (let k = start20; k <= i; k++) {
      if (nifty500[k] > peak20) peak20 = nifty500[k];
    }
    nifty500_20d_dropPct[i] = peak20 > 0 ? ((nifty500[i] - peak20) / peak20) * 100 : 0;

    // 3. Compute Realized Volatility + Historical VIX calibration
    const dateStr = allDates[i];
    let baseVixVal = 13.8;

    const volStart = Math.max(0, i - 19);
    let returnsSum = 0;
    let returnsCount = 0;
    for (let v = volStart + 1; v <= i; v++) {
      const r = (nifty50[v] - nifty50[v - 1]) / nifty50[v - 1];
      returnsSum += r * r;
      returnsCount++;
    }
    const realizedDailyVar = returnsCount > 0 ? returnsSum / returnsCount : 0.0001;
    const annualizedRealizedVol = Math.sqrt(realizedDailyVar * 252) * 100;

    let anchorVix = 0;
    for (const anchor of VIX_ANCHORS) {
      if (dateStr >= anchor.startDate && dateStr <= anchor.endDate) {
        anchorVix = Math.max(anchorVix, anchor.peakVix);
        break;
      }
    }

    if (anchorVix > 0) {
      baseVixVal = Math.max(anchorVix, annualizedRealizedVol * 1.2);
    } else {
      baseVixVal = Math.max(12.0, annualizedRealizedVol * 1.1);
    }

    indiaVix[i] = parseFloat(baseVixVal.toFixed(2));
  }

  // 4. Precompute Stock-by-Stock 50 EMA, 50 DMA, 200 DMA to build 100% Real Market Breadth
  const symbolEma50 = new Map<string, Float32Array>();
  const symbolDma50 = new Map<string, Float32Array>();
  const symbolDma200 = new Map<string, Float32Array>();

  for (let s = 0; s < symbols.length; s++) {
    const sym = symbols[s];
    const candles = symbolCandles.get(sym);
    if (!candles || candles.length === 0) continue;

    const numCandles = candles.length;
    const ema50Arr = new Float32Array(numCandles);
    const dma50Arr = new Float32Array(numCandles);
    const dma200Arr = new Float32Array(numCandles);

    let runningEma = candles[0].close;
    let runningSum50 = 0;
    let runningSum200 = 0;

    for (let c = 0; c < numCandles; c++) {
      const close = candles[c].close;
      // 50 EMA
      if (c === 0) {
        runningEma = close;
      } else {
        runningEma = (close - runningEma) * ema50Multiplier + runningEma;
      }
      ema50Arr[c] = runningEma;

      // 50 DMA
      runningSum50 += close;
      if (c >= 50) {
        runningSum50 -= candles[c - 50].close;
        dma50Arr[c] = runningSum50 / 50;
      } else {
        dma50Arr[c] = runningSum50 / (c + 1);
      }

      // 200 DMA
      runningSum200 += close;
      if (c >= 200) {
        runningSum200 -= candles[c - 200].close;
        dma200Arr[c] = runningSum200 / 200;
      } else {
        dma200Arr[c] = runningSum200 / (c + 1);
      }
    }

    symbolEma50.set(sym, ema50Arr);
    symbolDma50.set(sym, dma50Arr);
    symbolDma200.set(sym, dma200Arr);
  }

  // 5. Aggregate Daily Market Breadth across all active stocks on each trading date
  for (let i = 0; i < len; i++) {
    const d = allDates[i];
    let totalActive = 0;
    let above50EmaCount = 0;
    let above50DmaCount = 0;
    let above200DmaCount = 0;

    for (let s = 0; s < symbols.length; s++) {
      const sym = symbols[s];
      const dateMap = symbolDateIdx.get(sym);
      const cIdx = dateMap ? dateMap.get(d) : undefined;
      if (cIdx === undefined || cIdx < 50) continue; // Requires at least 50 days of trading

      const candles = symbolCandles.get(sym);
      if (!candles) continue;
      const close = candles[cIdx].close;
      if (close <= 0) continue;

      totalActive++;

      const e50 = symbolEma50.get(sym)?.[cIdx] ?? close;
      const d50 = symbolDma50.get(sym)?.[cIdx] ?? close;
      const d200 = symbolDma200.get(sym)?.[cIdx] ?? close;

      if (close >= e50) above50EmaCount++;
      if (close >= d50) above50DmaCount++;
      if (close >= d200) above200DmaCount++;
    }

    if (totalActive > 30) {
      breadthPctAbove50Ema[i] = parseFloat(((above50EmaCount / totalActive) * 100).toFixed(1));
      breadthPctAbove50Dma[i] = parseFloat(((above50DmaCount / totalActive) * 100).toFixed(1));
      breadthPctAbove200Dma[i] = parseFloat(((above200DmaCount / totalActive) * 100).toFixed(1));
    } else {
      breadthPctAbove50Ema[i] = 50;
      breadthPctAbove50Dma[i] = 50;
      breadthPctAbove200Dma[i] = 50;
    }
  }

  return {
    dates: allDates,
    nifty50,
    nifty50_200dma,
    nifty50_200ema,
    nifty50_50dma,
    nifty50_50ema,
    nifty500,
    nifty500_200dma,
    nifty500_200ema,
    nifty500_100ema,
    nifty500_50dma,
    nifty500_50ema,
    indiaVix,
    breadthPctAbove50Ema,
    breadthPctAbove50Dma,
    breadthPctAbove200Dma,
    nifty500_20d_dropPct,
  };
}

export interface CircuitBreakerEvaluation {
  isActive: boolean;
  reason: string;
  label: string;
  triggeredRules: string[];
}

/**
 * Evaluates customizable Multi-Condition OR/AND Circuit Breakers or legacy MacroRegimeFilter
 */
export function isMacroCircuitBreakerActive(
  timeline: MacroDailyTimeline,
  dateIdx: number,
  macroFilter: MacroRegimeFilter = 'none',
  vixThreshold: number = 25,
  circuitBreakers?: CircuitBreakersConfig
): CircuitBreakerEvaluation {
  // 1. If modern CircuitBreakersConfig is provided and enabled, evaluate multi-condition OR/AND rules
  if (circuitBreakers && circuitBreakers.enabled) {
    const triggeredRules: string[] = [];
    let totalEnabledRules = 0;

    // Rule A: Benchmark Trend (e.g. Nifty 500 < 200 EMA)
    if (circuitBreakers.benchmarkTrend?.enabled) {
      totalEnabledRules++;
      const isNifty500 = circuitBreakers.benchmarkTrend.index === 'NIFTY500';
      const indexLevel = isNifty500 ? timeline.nifty500[dateIdx] : timeline.nifty50[dateIdx];
      const ind = circuitBreakers.benchmarkTrend.indicator;
      let maVal = 0;

      if (isNifty500) {
        if (ind === '200_EMA') maVal = timeline.nifty500_200ema[dateIdx];
        else if (ind === '200_DMA') maVal = timeline.nifty500_200dma[dateIdx];
        else if (ind === '100_EMA') maVal = timeline.nifty500_100ema[dateIdx];
        else if (ind === '50_EMA') maVal = timeline.nifty500_50ema[dateIdx];
        else if (ind === '50_DMA') maVal = timeline.nifty500_50dma[dateIdx];
        else maVal = timeline.nifty500_200ema[dateIdx];
      } else {
        if (ind === '200_EMA') maVal = timeline.nifty50_200ema[dateIdx];
        else if (ind === '200_DMA') maVal = timeline.nifty50_200dma[dateIdx];
        else if (ind === '50_EMA') maVal = timeline.nifty50_50ema[dateIdx];
        else if (ind === '50_DMA') maVal = timeline.nifty50_50dma[dateIdx];
        else maVal = timeline.nifty50_200ema[dateIdx];
      }

      if (indexLevel < maVal) {
        const idxName = isNifty500 ? 'N500' : 'N50';
        const indLabel = ind.replace('_', ' ');
        triggeredRules.push(`${idxName} (${indexLevel.toFixed(0)}) < ${indLabel} (${maVal.toFixed(0)})`);
      }
    }

    // Rule B: India VIX Spike (e.g. VIX > 30)
    if (circuitBreakers.vixSpike?.enabled) {
      totalEnabledRules++;
      const vix = timeline.indiaVix[dateIdx];
      const threshold = circuitBreakers.vixSpike.threshold ?? 30;
      if (vix > threshold) {
        triggeredRules.push(`India VIX (${vix.toFixed(1)}) > ${threshold}`);
      }
    }

    // Rule C: Market Breadth Breakdown (e.g. % of Nifty 500 stocks > 50 EMA < 45%)
    if (circuitBreakers.marketBreadth?.enabled) {
      totalEnabledRules++;
      const ind = circuitBreakers.marketBreadth.indicator ?? '50_EMA';
      let breadthPct = 0;
      if (ind === '50_EMA') breadthPct = timeline.breadthPctAbove50Ema[dateIdx];
      else if (ind === '50_DMA') breadthPct = timeline.breadthPctAbove50Dma[dateIdx];
      else if (ind === '200_DMA') breadthPct = timeline.breadthPctAbove200Dma[dateIdx];

      const threshold = circuitBreakers.marketBreadth.thresholdPct ?? 45;
      if (breadthPct < threshold) {
        const indLabel = ind.replace('_', ' ');
        triggeredRules.push(`Breadth (${breadthPct.toFixed(0)}% > ${indLabel}) < ${threshold}%`);
      }
    }

    // Rule D: Rapid Short-Term Market Drop (e.g. N500 drop from 20-day high > 6%)
    if (circuitBreakers.rapidDrawdown?.enabled) {
      totalEnabledRules++;
      const dropPct = Math.abs(timeline.nifty500_20d_dropPct[dateIdx]);
      const threshold = circuitBreakers.rapidDrawdown.dropPct ?? 6;
      if (dropPct > threshold) {
        triggeredRules.push(`N500 20D Drop (-${dropPct.toFixed(1)}%) > ${threshold}%`);
      }
    }

    if (totalEnabledRules > 0) {
      const isOr = circuitBreakers.logic !== 'AND';
      const isActive = isOr ? triggeredRules.length > 0 : triggeredRules.length === totalEnabledRules;

      if (isActive) {
        return {
          isActive: true,
          reason: `Macro Breaker (${circuitBreakers.logic}): ${triggeredRules.join(' | ')}`,
          label: `${triggeredRules.length} Breaker${triggeredRules.length > 1 ? 's' : ''} Active (${circuitBreakers.logic})`,
          triggeredRules,
        };
      }

      return {
        isActive: false,
        reason: '',
        label: 'Normal Regime (100% Equity)',
        triggeredRules: [],
      };
    }
  }

  // 2. Fallback to classic Single-Condition MacroRegimeFilter
  if (macroFilter === 'none') {
    return { isActive: false, reason: '', label: 'Normal Regime (100% Equity)', triggeredRules: [] };
  }

  if (macroFilter === 'nifty50_below_200dma') {
    const n50 = timeline.nifty50[dateIdx];
    const dma = timeline.nifty50_200dma[dateIdx];
    if (n50 < dma) {
      return {
        isActive: true,
        reason: `Macro Circuit Breaker: Nifty 50 (${n50.toFixed(0)}) < 200 DMA (${dma.toFixed(0)})`,
        label: 'Nifty 50 < 200 DMA (100% Cash)',
        triggeredRules: [`Nifty 50 < 200 DMA`],
      };
    }
  } else if (macroFilter === 'nifty50_below_200ema') {
    const n50 = timeline.nifty50[dateIdx];
    const ema = timeline.nifty50_200ema[dateIdx];
    if (n50 < ema) {
      return {
        isActive: true,
        reason: `Macro Circuit Breaker: Nifty 50 (${n50.toFixed(0)}) < 200 EMA (${ema.toFixed(0)})`,
        label: 'Nifty 50 < 200 EMA (100% Cash)',
        triggeredRules: [`Nifty 50 < 200 EMA`],
      };
    }
  } else if (macroFilter === 'nifty500_below_200dma') {
    const n500 = timeline.nifty500[dateIdx];
    const dma = timeline.nifty500_200dma[dateIdx];
    if (n500 < dma) {
      return {
        isActive: true,
        reason: `Macro Circuit Breaker: Nifty 500 (${n500.toFixed(0)}) < 200 DMA (${dma.toFixed(0)})`,
        label: 'Nifty 500 < 200 DMA (100% Cash)',
        triggeredRules: [`Nifty 500 < 200 DMA`],
      };
    }
  } else if (macroFilter === 'nifty500_below_200ema') {
    const n500 = timeline.nifty500[dateIdx];
    const ema = timeline.nifty500_200ema[dateIdx];
    if (n500 < ema) {
      return {
        isActive: true,
        reason: `Macro Circuit Breaker: Nifty 500 (${n500.toFixed(0)}) < 200 EMA (${ema.toFixed(0)})`,
        label: 'Nifty 500 < 200 EMA (100% Cash)',
        triggeredRules: [`Nifty 500 < 200 EMA`],
      };
    }
  } else if (macroFilter === 'vix_above_threshold') {
    const vix = timeline.indiaVix[dateIdx];
    if (vix > vixThreshold) {
      return {
        isActive: true,
        reason: `Macro Circuit Breaker: India VIX (${vix.toFixed(1)}) > ${vixThreshold} Threshold`,
        label: `India VIX > ${vixThreshold} (100% Cash)`,
        triggeredRules: [`India VIX > ${vixThreshold}`],
      };
    }
  }

  return { isActive: false, reason: '', label: 'Normal Regime (100% Equity)', triggeredRules: [] };
}

